import {
  ChunkIndexRecord,
  ChunkSimilarityHit,
  searchTopChunksByEmbedding,
  getChunksByMemoIds,
} from "../db/chunkIndexRepo";
import { searchByTokens } from "../db/tokenIndexRepo";
import { getEmbeddingProvider } from "./EmbeddingProvider";
import { extractTokens, normalizeParens } from "../utils/wikiLink";

export type HybridSearchResult = {
  memoId: string;
  chunkId: string;
  snippetText: string;
  score: number;
  createdAt: number;
  tokensHit: string[];
  queryTokenMatched: boolean;
  queryTokenHitCount: number;
};

type HybridSearchOptions = {
  topK?: number;
  topN?: number;
};

const DEFAULT_TOP_K = 8;
const DEFAULT_TOP_N = 8;
const TOKEN_MEMO_BOOST = 0.45;
const TOKEN_CHUNK_BOOST = 0.25;
const TOKEN_ONLY_BASE_SCORE = 0.35;
const EXPLICIT_TOKEN_MATCH_BOOST = 1.1;
const EXPLICIT_TOKEN_MISS_PENALTY = 0.25;
const MIN_EMBEDDING_SIMILARITY = 0.12;
const EMBEDDING_RELATIVE_CUTOFF = 0.82;
const CACHE_TTL_MS = 30_000;
const SNIPPET_MAX_LENGTH = 420;

const cache = new Map<
  string,
  { expiresAt: number; results: HybridSearchResult[] }
>();

export const invalidateHybridSearchCache = (): void => {
  cache.clear();
};

const toSnippet = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= SNIPPET_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, SNIPPET_MAX_LENGTH)}...`;
};

const intersectTokens = (left: string[], right: string[]): string[] => {
  if (left.length === 0 || right.length === 0) {
    return [];
  }
  const rightSet = new Set(right);
  return left.filter((token) => rightSet.has(token));
};

const mergeTokens = (tokens: string[]): string[] => Array.from(new Set(tokens));

const filterEmbeddingHits = (
  hits: ChunkSimilarityHit[],
): ChunkSimilarityHit[] => {
  if (hits.length === 0) {
    return [];
  }
  const topSimilarity = Math.max(...hits.map((item) => item.similarity));
  const similarityFloor = Math.max(
    MIN_EMBEDDING_SIMILARITY,
    topSimilarity * EMBEDDING_RELATIVE_CUTOFF,
  );
  return hits.filter((item) => item.similarity >= similarityFloor);
};

const pickTokenPreferredChunk = (
  chunks: ChunkIndexRecord[],
  tokens: string[],
): ChunkIndexRecord | null => {
  if (chunks.length === 0) {
    return null;
  }
  const sorted = [...chunks].sort((a, b) => {
    const aHits = intersectTokens(a.tags, tokens).length;
    const bHits = intersectTokens(b.tags, tokens).length;
    if (aHits !== bHits) {
      return bHits - aHits;
    }
    return a.chunkId.localeCompare(b.chunkId);
  });
  return sorted[0] ?? null;
};

const resolveScore = (params: {
  semanticScore: number;
  memoTokensHitCount: number;
  chunkTokensHitCount: number;
  hasExplicitQueryTokens: boolean;
}): number => {
  const {
    semanticScore,
    memoTokensHitCount,
    chunkTokensHitCount,
    hasExplicitQueryTokens,
  } = params;
  let score = semanticScore;
  if (memoTokensHitCount > 0) {
    score += TOKEN_MEMO_BOOST + memoTokensHitCount * 0.5;
  }
  if (chunkTokensHitCount > 0) {
    score += TOKEN_CHUNK_BOOST + chunkTokensHitCount * 0.3;
  }
  if (hasExplicitQueryTokens) {
    if (chunkTokensHitCount > 0) {
      score += EXPLICIT_TOKEN_MATCH_BOOST + chunkTokensHitCount * 0.35;
    } else {
      score -= EXPLICIT_TOKEN_MISS_PENALTY;
    }
  }
  return Number(score.toFixed(6));
};

export const hybridSearch = async (
  queryText: string,
  options: HybridSearchOptions = {},
): Promise<HybridSearchResult[]> => {
  const normalizedQuery = normalizeParens(queryText).trim();
  if (!normalizedQuery) {
    return [];
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  const topN = options.topN ?? DEFAULT_TOP_N;
  const cacheKey = `${normalizedQuery}::${topK}::${topN}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }

  const queryTokens = extractTokens(normalizedQuery);
  const hasExplicitQueryTokens = queryTokens.length > 0;
  const embeddingProvider = getEmbeddingProvider();

  const [tokenHits, embeddingHits] = await Promise.all([
    queryTokens.length > 0 ? searchByTokens(queryTokens) : Promise.resolve([]),
    embeddingProvider
      .embed(normalizedQuery)
      .then((embedding) =>
        searchTopChunksByEmbedding(embedding, topK, {
          embeddingModel: embeddingProvider.getModel(),
          embeddingDim: embeddingProvider.getDim() || embedding.length,
        }),
      ),
  ]);
  const filteredEmbeddingHits = filterEmbeddingHits(embeddingHits);

  const tokenSetByMemoId = new Map<string, Set<string>>();
  const tokenSnippetByMemoId = new Map<string, string>();
  const createdAtByMemoId = new Map<string, number>();

  for (const hit of tokenHits) {
    const tokens = tokenSetByMemoId.get(hit.memoId) ?? new Set<string>();
    tokens.add(hit.token);
    tokenSetByMemoId.set(hit.memoId, tokens);
    if (hit.snippet && !tokenSnippetByMemoId.has(hit.memoId)) {
      tokenSnippetByMemoId.set(hit.memoId, hit.snippet);
    }
    const existingCreatedAt = createdAtByMemoId.get(hit.memoId) ?? 0;
    if (hit.updatedAt > existingCreatedAt) {
      createdAtByMemoId.set(hit.memoId, hit.updatedAt);
    }
  }

  const evidenceByChunkId = new Map<string, HybridSearchResult>();

  for (const hit of filteredEmbeddingHits) {
    const memoTokensHit = Array.from(tokenSetByMemoId.get(hit.memoId) ?? []);
    const chunkTokensHit = intersectTokens(hit.tags, queryTokens);
    const tokensHit = mergeTokens([...memoTokensHit, ...chunkTokensHit]);
    const scored = resolveScore({
      semanticScore: hit.similarity,
      memoTokensHitCount: memoTokensHit.length,
      chunkTokensHitCount: chunkTokensHit.length,
      hasExplicitQueryTokens,
    });
    evidenceByChunkId.set(hit.chunkId, {
      memoId: hit.memoId,
      chunkId: hit.chunkId,
      snippetText: toSnippet(hit.text),
      score: scored,
      createdAt: hit.createdAt,
      tokensHit,
      queryTokenMatched: chunkTokensHit.length > 0,
      queryTokenHitCount: chunkTokensHit.length,
    });
  }

  if (queryTokens.length > 0 && tokenSetByMemoId.size > 0) {
    const tokenMemoIds = Array.from(tokenSetByMemoId.keys());
    const chunks = await getChunksByMemoIds(tokenMemoIds);
    const chunksByMemoId = new Map<string, ChunkIndexRecord[]>();
    for (const chunk of chunks) {
      const existing = chunksByMemoId.get(chunk.memoId) ?? [];
      existing.push(chunk);
      chunksByMemoId.set(chunk.memoId, existing);
    }

    for (const memoId of tokenMemoIds) {
      const memoTokensHit = Array.from(tokenSetByMemoId.get(memoId) ?? []);
      const selectedChunk = pickTokenPreferredChunk(
        chunksByMemoId.get(memoId) ?? [],
        memoTokensHit,
      );
      if (!selectedChunk) {
        continue;
      }
      const chunkTokensHit = intersectTokens(selectedChunk.tags, memoTokensHit);
      if (chunkTokensHit.length === 0) {
        continue;
      }
      const score = Number(
        (
          TOKEN_ONLY_BASE_SCORE +
          memoTokensHit.length * 0.5 +
          chunkTokensHit.length * 0.3
        ).toFixed(6),
      );
      const existing = evidenceByChunkId.get(selectedChunk.chunkId);
      const snippetText =
        tokenSnippetByMemoId.get(memoId) ?? toSnippet(selectedChunk.text);
      if (!existing || score > existing.score) {
        evidenceByChunkId.set(selectedChunk.chunkId, {
          memoId,
          chunkId: selectedChunk.chunkId,
          snippetText,
          score,
          createdAt:
            createdAtByMemoId.get(memoId) ?? selectedChunk.createdAt,
          tokensHit: chunkTokensHit,
          queryTokenMatched: true,
          queryTokenHitCount: chunkTokensHit.length,
        });
      } else {
        const mergedTokens = mergeTokens([...existing.tokensHit, ...chunkTokensHit]);
        evidenceByChunkId.set(selectedChunk.chunkId, {
          ...existing,
          tokensHit: mergedTokens,
          queryTokenMatched: existing.queryTokenMatched || chunkTokensHit.length > 0,
          queryTokenHitCount: Math.max(
            existing.queryTokenHitCount,
            chunkTokensHit.length,
          ),
        });
      }
    }
  }

  const results = Array.from(evidenceByChunkId.values())
    .sort((a, b) => {
      if (hasExplicitQueryTokens) {
        const matchedDiff = Number(b.queryTokenMatched) - Number(a.queryTokenMatched);
        if (matchedDiff !== 0) {
          return matchedDiff;
        }
        const tokenHitDiff = b.queryTokenHitCount - a.queryTokenHitCount;
        if (tokenHitDiff !== 0) {
          return tokenHitDiff;
        }
      }
      return b.score - a.score || a.chunkId.localeCompare(b.chunkId);
    })
    .slice(0, topN);

  const noteEvidenceCount = results.filter((item) =>
    item.memoId.startsWith("note:"),
  ).length;
  console.log(
    `[HybridSearch] queryLength=${normalizedQuery.length} results=${results.length} noteEvidence=${noteEvidenceCount}`,
  );

  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    results,
  });

  return results;
};

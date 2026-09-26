import { getChunksByMemoIds } from "../db/chunkIndexRepo";
import { getMemoById } from "../db/memoRepo";
import { getNoteById } from "../db/noteRepo";
import { findWikiLinkedMemoIds, getTokensByMemoIds } from "../db/tokenIndexRepo";
import { cosineSimilarity } from "../utils/similarity";
import { getEmbeddingProvider } from "./EmbeddingProvider";
import { hybridSearch } from "./hybridSearch";
import { listResearchNotes } from "./researchNoteService";
import { retrieveWikiAnswerEvidence, type WikiAnswerDocument } from "./wikiAnswerRetrievalCore";

export const searchWikiAnswerEvidence = async (query: string, maxMemos = 15) => {
  if (!query.trim()) return [];
  let researchNotes: ReturnType<typeof listResearchNotes> | undefined;
  const provider = getEmbeddingProvider();
  const queryEmbedding = await provider.embed(query);
  const hits = await hybridSearch(query, { topK: 60, topN: 60, queryEmbedding });
  const seedIds = Array.from(new Set(hits.map((hit) => hit.memoId)));
  return retrieveWikiAnswerEvidence(query, seedIds, {
    findLinkedMemoIds: findWikiLinkedMemoIds,
    loadDocuments: async (ids) => {
      const [tokens, chunks, records] = await Promise.all([
        getTokensByMemoIds(ids),
        getChunksByMemoIds(ids),
        Promise.all(ids.map(async (memoId) => {
          const record = memoId.startsWith("note:")
            ? await getNoteById(memoId.slice(5))
            : memoId.startsWith("tankyu:")
              ? (await (researchNotes ??= listResearchNotes())).find((note) => note.id === memoId.slice(7))
              : await getMemoById(memoId);
          return record ? { memoId, record } : null;
        })),
      ]);
      const similarities = new Map<string, number>();
      const semanticText = new Map<string, string>();
      for (const chunk of chunks) {
        if (chunk.embeddingStatus !== "completed" || chunk.embeddingModel !== provider.getModel()) continue;
        const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
        if (similarity !== null && similarity > (similarities.get(chunk.memoId) ?? -Infinity)) {
          similarities.set(chunk.memoId, similarity);
          semanticText.set(chunk.memoId, chunk.text);
        }
      }
      return records.flatMap((entry): WikiAnswerDocument[] => entry ? [{
        memoId: entry.memoId,
        body: entry.record.body,
        updatedAt: entry.record.updatedAt,
        tokens: tokens.get(entry.memoId) ?? [],
        semanticScore: similarities.get(entry.memoId) ?? 0,
        semanticText: semanticText.get(entry.memoId),
      }] : []);
    },
  }, maxMemos);
};

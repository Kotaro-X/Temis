import { answerWithCitations } from "../services/answerWithCitations";
import type { AIEvidence } from "../types";
import { parseAIResponse } from "./answerParser";
import { buildAIContext } from "./contextBuilder";
import { buildAIQuery } from "./promptBuilder";

const DEFAULT_TOP_K = 4;

const labelEvidence = (
  evidence: Awaited<ReturnType<typeof buildAIContext>>,
): AIEvidence[] =>
  evidence
    .slice()
    .sort(
      (left, right) =>
        (right.tokensHit?.length ?? 0) - (left.tokensHit?.length ?? 0) ||
        (right.score ?? 0) - (left.score ?? 0) ||
        left.chunkId.localeCompare(right.chunkId),
    )
    .map((item, index) => ({
      key: `E${index + 1}`,
      memoId: item.memoId,
      chunkId: item.chunkId,
      snippetText: item.snippetText,
      createdAt: item.createdAt,
      tokensHit: item.tokensHit,
      score: item.score,
    }));

export const searchAndGenerateAnswer = async (
  query: string,
  options?: { topK?: number; topN?: number },
): Promise<{
  answer: ReturnType<typeof parseAIResponse>;
  allEvidence: AIEvidence[];
}> => {
  const normalized = buildAIQuery(query);
  if (!normalized) {
    return {
      answer: parseAIResponse({ answerText: "", citedEvidenceKeys: [] }),
      allEvidence: [],
    };
  }

  const searchResults = await buildAIContext(normalized, {
    topK: options?.topK ?? DEFAULT_TOP_K,
    topN: options?.topN ?? options?.topK ?? DEFAULT_TOP_K,
  });
  const allEvidence = labelEvidence(searchResults);
  if (allEvidence.length === 0) {
    return {
      answer: parseAIResponse({ answerText: "", citedEvidenceKeys: [] }),
      allEvidence,
    };
  }

  const answered = await answerWithCitations(normalized, searchResults);
  return {
    answer: parseAIResponse(answered),
    allEvidence,
  };
};

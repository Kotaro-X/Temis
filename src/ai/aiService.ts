import { answerWithCitations } from "../services/answerWithCitations";
import { labelAnswerEvidence } from "../services/aiEvidence";
import type { AIEvidence } from "../types";
import { parseAIResponse } from "./answerParser";
import { buildAIContext } from "./contextBuilder";
import { buildAIQuery } from "./promptBuilder";

const DEFAULT_TOP_K = 15;

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
  const allEvidence = labelAnswerEvidence(searchResults);
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

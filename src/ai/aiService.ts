import { answerWithCitations } from "../services/answerWithCitations";
import { labelAnswerEvidence } from "../services/aiEvidence";
import type { AIEvidence } from "../types";
import { parseAIResponse } from "./answerParser";
import { buildAIContext } from "./contextBuilder";
import { buildAIQuery } from "./promptBuilder";
import { cancelTemisAIUsage, completeTemisAIUsage } from "../services/freemium/temisFreemiumService";
import type { EvidenceInput } from "../services/aiEvidence";

const DEFAULT_TOP_K = 15;

export const searchAndGenerateAnswer = async (
  query: string,
  options?: {
    topK?: number;
    topN?: number;
    requestId?: string;
    retrieveEvidence?: (query: string, options: { topK: number; topN: number }) => Promise<EvidenceInput[]>;
  },
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

  let searchResults;
  try {
    const retrievalOptions = {
      topK: options?.topK ?? DEFAULT_TOP_K,
      topN: options?.topN ?? options?.topK ?? DEFAULT_TOP_K,
    };
    searchResults = options?.retrieveEvidence
      ? await options.retrieveEvidence(normalized, retrievalOptions)
      : await buildAIContext(normalized, retrievalOptions);
  } catch (error) {
    if (options?.requestId) {
      await cancelTemisAIUsage(options.requestId).catch(() => undefined);
    }
    throw error;
  }
  const allEvidence = labelAnswerEvidence(searchResults);
  if (allEvidence.length === 0) {
    if (options?.requestId) {
      await completeTemisAIUsage(options.requestId);
    }
    return {
      answer: parseAIResponse({ answerText: "", citedEvidenceKeys: [] }),
      allEvidence,
    };
  }

  const answered = await answerWithCitations(
    normalized,
    searchResults,
    undefined,
    undefined,
    options?.requestId,
  );
  if (options?.requestId) {
    await completeTemisAIUsage(options.requestId);
  }
  if (answered.insufficientEvidence) {
    return {
      answer: parseAIResponse({ answerText: "", citedEvidenceKeys: [] }),
      allEvidence: [],
    };
  }
  return {
    answer: parseAIResponse(answered),
    allEvidence,
  };
};

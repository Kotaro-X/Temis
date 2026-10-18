import { searchWikiAnswerEvidence } from "../services/wikiAnswerRetrieval";

export const buildAIContext = async (
  query: string,
  options?: { topK?: number; topN?: number; expectedUid?: string },
) => searchWikiAnswerEvidence(query, options?.topN ?? options?.topK ?? 15, { expectedUid: options?.expectedUid });

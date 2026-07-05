import { hybridSearch, type HybridSearchResult } from "../services/hybridSearch";

export const buildAIContext = async (
  query: string,
  options?: { topK?: number; topN?: number },
): Promise<HybridSearchResult[]> =>
  hybridSearch(query, {
    topK: options?.topK ?? 4,
    topN: options?.topN ?? options?.topK ?? 4,
  });

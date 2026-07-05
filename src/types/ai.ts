export type AIEvidence = {
  key: string;
  memoId: string;
  chunkId: string;
  snippetText: string;
  createdAt: number;
  tokensHit?: string[];
  score?: number;
};

export type AIResponse = {
  answerText: string;
  citedEvidenceKeys: string[];
};

export type AIState = {
  query: string;
  loading: boolean;
  error: string | null;
  answerText: string;
  citedEvidenceKeys: string[];
};

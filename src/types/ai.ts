import type { EvidenceInput } from "../services/aiEvidence";

export type AIEvidence = EvidenceInput & { key: string };

export type AIResponse = {
  answerText: string;
  citedEvidenceKeys: string[];
  errorText?: string;
};

export type AIState = {
  query: string;
  loading: boolean;
  error: string | null;
  answerText: string;
  citedEvidenceKeys: string[];
};

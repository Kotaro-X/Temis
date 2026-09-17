import type { AIResponse } from "../types";

export const parseAIResponse = (input: {
  answerText: string;
  citedEvidenceKeys: string[];
  errorText?: string;
}): AIResponse => ({
  answerText: input.answerText.trim(),
  citedEvidenceKeys: input.citedEvidenceKeys,
  errorText: input.errorText?.trim() || undefined,
});

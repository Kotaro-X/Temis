import type { AIResponse } from "../types";

export const parseAIResponse = (input: {
  answerText: string;
  citedEvidenceKeys: string[];
}): AIResponse => ({
  answerText: input.answerText.trim(),
  citedEvidenceKeys: input.citedEvidenceKeys,
});

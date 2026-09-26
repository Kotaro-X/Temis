/** Keep retrieval order and labels identical from selection through rendering. */
export type EvidenceInput = {
  memoId: string;
  chunkId: string;
  snippetText: string;
  createdAt: number;
  tokensHit?: string[];
  score?: number;
  linkDepth?: number;
  linkPath?: string[];
};

export const MAX_ANSWER_MEMOS = 15;

export const labelAnswerEvidence = <T extends EvidenceInput>(
  evidence: T[],
  limit = MAX_ANSWER_MEMOS,
): (T & { key: string; evidenceKey: string })[] => {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (seen.has(item.memoId) || !item.snippetText.trim()) return false;
    seen.add(item.memoId);
    return true;
  }).slice(0, Math.min(MAX_ANSWER_MEMOS, Math.max(1, Math.floor(limit))))
    .map((item, index) => ({ ...item, key: `E${index + 1}`, evidenceKey: `E${index + 1}` }));
};

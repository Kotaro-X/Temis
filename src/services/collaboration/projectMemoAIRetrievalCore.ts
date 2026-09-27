import type { EvidenceInput } from "../aiEvidence";
import type { ProjectSharedNote } from "../../types/collaboration";
import { extractTokens, normalizeParens } from "../../utils/wikiLink.ts";

export type ProjectMemoSearchScope = "project" | "project_and_private";

export type RankedProjectMemo = {
  note: ProjectSharedNote;
  evidenceId: string;
  text: string;
  tokens: string[];
  lexicalScore: number;
  semanticScore: number;
};

export const projectMemoEvidenceId = (projectId: string, noteId: string): string =>
  `project-note:${encodeURIComponent(projectId)}:${encodeURIComponent(noteId)}`;

export const projectNoteIdFromEvidence = (memoId: string): string | null => {
  if (!memoId.startsWith("project-note:")) return null;
  const [, encodedProjectId, encodedNoteId] = memoId.split(":");
  if (!encodedProjectId || !encodedNoteId) return null;
  return decodeURIComponent(encodedNoteId);
};

export const notesForProject = (
  projectId: string,
  notes: ProjectSharedNote[],
): ProjectSharedNote[] => notes.filter((note) => note.projectId === projectId);

const normalizedWords = (value: string): string[] => Array.from(new Set(
  normalizeParens(value).toLocaleLowerCase().split(/[\s、。！？!?.,，．:：;；]+/u).filter((term) => term.length >= 2),
));

const lexicalScore = (query: string, note: ProjectSharedNote): number => {
  const normalizedQuery = normalizeParens(query).trim().toLocaleLowerCase();
  const title = normalizeParens(note.title ?? "").toLocaleLowerCase();
  const body = normalizeParens(note.body).toLocaleLowerCase();
  const tokens = extractTokens(note.body).map((token) => token.toLocaleLowerCase());
  let score = 0;
  if (title.includes(normalizedQuery)) score += 8;
  if (body.includes(normalizedQuery)) score += 5;
  for (const term of normalizedWords(normalizedQuery)) {
    if (title.includes(term)) score += 3;
    if (body.includes(term)) score += 1;
    if (tokens.some((token) => token.includes(term) || term.includes(token))) score += 4;
  }
  return score;
};

export const selectProjectMemoEmbeddingCandidates = (
  query: string,
  notes: ProjectSharedNote[],
  limit = 19,
): RankedProjectMemo[] => {
  if (!query.trim()) return [];
  const ranked = notes.filter((note) => note.title?.trim() || note.body.trim()).map((note) => ({
    note,
    evidenceId: projectMemoEvidenceId(note.projectId, note.id),
    text: [note.title?.trim(), note.body.trim()].filter(Boolean).join("\n"),
    tokens: extractTokens(note.body),
    lexicalScore: lexicalScore(query, note),
    semanticScore: 0,
  })).sort((left, right) => right.lexicalScore - left.lexicalScore
    || right.note.updatedAt - left.note.updatedAt
    || left.note.id.localeCompare(right.note.id));
  const lexical = ranked.filter((item) => item.lexicalScore > 0).slice(0, Math.ceil(limit / 2));
  const selected = new Map(lexical.map((item) => [item.note.id, item]));
  for (const item of [...ranked].sort((left, right) => right.note.updatedAt - left.note.updatedAt)) {
    if (selected.size >= limit) break;
    selected.set(item.note.id, item);
  }
  return Array.from(selected.values());
};

export const mergeProjectAndPersonalEvidence = (
  project: EvidenceInput[],
  personal: EvidenceInput[],
  limit = 15,
): EvidenceInput[] => {
  const seen = new Set<string>();
  return [...project, ...personal]
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0)
      || right.createdAt - left.createdAt
      || left.memoId.localeCompare(right.memoId))
    .filter((item) => {
      if (seen.has(item.memoId)) return false;
      seen.add(item.memoId);
      return true;
    })
    .slice(0, limit);
};

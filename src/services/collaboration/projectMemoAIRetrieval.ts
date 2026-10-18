import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp } from '../sync/firebaseApp';
import { requireAIConsent, validateConsentReceipt } from '../ai/aiConsent';
import type { EvidenceInput } from "../aiEvidence";
import type { ProjectSharedNote } from "../../types/collaboration";
import { cosineSimilarity } from "../../utils/similarity";
import { retrieveWikiAnswerEvidence } from "../wikiAnswerRetrievalCore";
import { searchWikiAnswerEvidence } from "../wikiAnswerRetrieval";
import {
  mergeProjectAndPersonalEvidence,
  notesForProject,
  projectMemoEvidenceId,
  projectNoteIdFromEvidence,
  selectProjectMemoEmbeddingCandidates,
  type ProjectMemoSearchScope,
} from "./projectMemoAIRetrievalCore";

const MAX_EVIDENCE = 15;

export const searchProjectMemoEvidence = async (
  query: string,
  projectId: string,
  notes: ProjectSharedNote[],
  maxMemos = MAX_EVIDENCE,
  expectedUid?: string,
): Promise<EvidenceInput[]> => {
  if (!query.trim()) return [];
  const receipt = await requireAIConsent(false, expectedUid);
  const functions = getFunctions(getFirebaseApp(), "asia-northeast1");
  const proposed = selectProjectMemoEmbeddingCandidates(query, notesForProject(projectId, notes));
  const permitted = (await httpsCallable<{ projectId: string; noteIds: string[]; userId: string }, { notes: ProjectSharedNote[] }>(functions, "getConsentedProjectNotes")({ projectId, userId: receipt.uid, noteIds: proposed.map(item => item.note.id) })).data.notes;
  await validateConsentReceipt(receipt);
  const candidates = selectProjectMemoEmbeddingCandidates(
    query,
    notesForProject(projectId, permitted),
  );
  if (candidates.length === 0) return [];
  try {
    const vectors = (await httpsCallable<{ projectId: string; noteIds: string[]; question: string; userId: string }, { embeddings: number[][] }>(functions, "createProjectEmbeddings")({ projectId, userId: receipt.uid, noteIds: candidates.map(item => item.note.id), question: query })).data.embeddings;
    await validateConsentReceipt(receipt);
    const queryVector = vectors[0];
    if (queryVector) {
      candidates.forEach((item, index) => {
        item.semanticScore = cosineSimilarity(queryVector, vectors[index + 1] ?? []) ?? 0;
      });
    }
  } catch {
    // Lexical and recency ranking remains available when embedding generation is unavailable.
  }
  const refreshed = (await httpsCallable<{ projectId: string; noteIds: string[]; userId: string }, { notes: ProjectSharedNote[] }>(functions, "getConsentedProjectNotes")({ projectId, userId: receipt.uid, noteIds: candidates.map(item => item.note.id) })).data.notes;
  await validateConsentReceipt(receipt);
  const currentNotes = new Map(refreshed.map(note => [note.id, note]));
  for (let index = candidates.length - 1; index >= 0; index--) {
    const item = candidates[index]; const current = currentNotes.get(item.note.id);
    if (!current || current.title !== item.note.title || current.body !== item.note.body) candidates.splice(index, 1);
  }
  candidates.sort((left, right) => right.semanticScore - left.semanticScore
    || right.lexicalScore - left.lexicalScore
    || right.note.updatedAt - left.note.updatedAt);
  const byEvidenceId = new Map(candidates.map((item) => [item.evidenceId, item]));
  const byToken = new Map<string, Set<string>>();
  for (const item of candidates) {
    for (const token of item.tokens) {
      const ids = byToken.get(token) ?? new Set<string>();
      ids.add(item.evidenceId);
      byToken.set(token, ids);
    }
  }
  return retrieveWikiAnswerEvidence(query, candidates.slice(0, 4).map((item) => item.evidenceId), {
    findLinkedMemoIds: async (tokens: string[], excludedIds: string[]) => {
      const excluded = new Set(excludedIds);
      return Array.from(new Set(tokens.flatMap((token) => Array.from(byToken.get(token) ?? []))))
        .filter((id) => !excluded.has(id));
    },
    loadDocuments: async (ids: string[]) => ids.flatMap((id) => {
      const item = byEvidenceId.get(id);
      if (!item) return [];
      return [{
        memoId: projectMemoEvidenceId(item.note.projectId, item.note.id),
        body: item.text,
        updatedAt: item.note.updatedAt,
        tokens: item.tokens,
        semanticScore: item.semanticScore + Math.min(item.lexicalScore, 10) / 20,
        semanticText: item.text,
      }];
    }),
  }, maxMemos);
};

export const searchProjectMemoAIContext = async (
  query: string,
  projectId: string,
  notes: ProjectSharedNote[],
  scope: ProjectMemoSearchScope,
  expectedUid?: string,
): Promise<EvidenceInput[]> => {
  const projectEvidencePromise = searchProjectMemoEvidence(query, projectId, notes, MAX_EVIDENCE, expectedUid);
  if (scope === "project") return projectEvidencePromise;
  const [projectEvidence, personalEvidence] = await Promise.all([
    projectEvidencePromise,
    searchWikiAnswerEvidence(query, MAX_EVIDENCE, { noteScope: "personal", expectedUid }),
  ]);
  return mergeProjectAndPersonalEvidence(projectEvidence, personalEvidence, MAX_EVIDENCE);
};

export type { ProjectMemoSearchScope };
export { projectNoteIdFromEvidence };

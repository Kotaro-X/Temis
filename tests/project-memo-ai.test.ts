import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  mergeProjectAndPersonalEvidence,
  notesForProject,
  projectMemoEvidenceId,
  projectNoteIdFromEvidence,
  selectProjectMemoEmbeddingCandidates,
} from "../src/services/collaboration/projectMemoAIRetrievalCore.ts";
import type { ProjectSharedNote } from "../src/types/collaboration.ts";

const note = (
  id: string,
  projectId: string,
  title: string,
  body: string,
  updatedAt: number,
): ProjectSharedNote => ({
  id,
  projectId,
  ownerUserId: "owner",
  sourceNoteId: id,
  title,
  body,
  updatedAt,
});

test("project memo candidate selection handles empty queries and prioritizes relevant notes", () => {
  const notes = [
    note("recent", "p1", "雑記", "別の内容", 30),
    note("sauna", "p1", "サウナ企画", "テントサウナの候補地", 10),
  ];
  assert.deepEqual(selectProjectMemoEmbeddingCandidates("", notes), []);
  const ranked = selectProjectMemoEmbeddingCandidates("テントサウナ", notes);
  assert.equal(ranked[0]?.note.id, "sauna");
});

test("project memo candidates preserve Wiki links for traversal", () => {
  const ranked = selectProjectMemoEmbeddingCandidates("候補地", [
    note("linked", "p1", "候補地", "((富士山))の近くを調査", 1),
  ]);
  assert.deepEqual(ranked[0]?.tokens, ["富士山"]);
});

test("project memo scope excludes notes from other projects", () => {
  const notes = [
    note("inside", "p1", "Project 1", "本文", 1),
    note("outside", "p2", "Project 2", "本文", 2),
  ];
  assert.deepEqual(notesForProject("p1", notes).map((item) => item.id), ["inside"]);
});

test("project evidence ids round-trip to the correct editor note", () => {
  const id = projectMemoEvidenceId("project:one", "note/two");
  assert.equal(projectNoteIdFromEvidence(id), "note/two");
  assert.equal(projectNoteIdFromEvidence("note:private"), null);
});

test("combined evidence is relevance ordered, deduplicated, and capped", () => {
  const project = [{ memoId: "project:1", chunkId: "p", snippetText: "p", createdAt: 1, score: 0.9 }];
  const personal = [
    { memoId: "private:1", chunkId: "a", snippetText: "a", createdAt: 2, score: 0.8 },
    { memoId: "project:1", chunkId: "duplicate", snippetText: "duplicate", createdAt: 3, score: 0.7 },
  ];
  assert.deepEqual(
    mergeProjectAndPersonalEvidence(project, personal, 2).map((item) => item.memoId),
    ["project:1", "private:1"],
  );
});

test("combined Project search is personal-only and scope changes reset stale evidence", () => {
  const retrieval = readFileSync("src/services/collaboration/projectMemoAIRetrieval.ts", "utf8");
  const screen = readFileSync("src/screens/ProjectWorkspaceScreen.tsx", "utf8");
  assert.equal(retrieval.includes('{ noteScope: "personal" }'), true);
  assert.match(screen, /const changeMemoAIScope[\s\S]*setMemoAIScope\(scope\);[\s\S]*resetMemoAI\(\);/);
});

test("Project and private evidence open their corresponding memo editors", () => {
  const screen = readFileSync("src/screens/ProjectWorkspaceScreen.tsx", "utf8");
  assert.match(screen, /note \? openComposer\("memos", note\) : openMemoDetail\(result\.memoId\)/);
});

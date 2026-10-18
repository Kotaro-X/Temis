import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { extractTokens } from "../src/utils/wikiLink.ts";
import { projectMemoEvidenceId } from "../src/services/collaboration/projectMemoAIRetrievalCore.ts";

function fixture() {
  const exports: any = {};
  const records: any = {
    private: { type: "free", scope: "personal", title: "Private", body: "((Topic))", updatedAt: 3 },
    mirror: { type: "free", scope: "project", projectId: "p", title: "Mirror", body: "((Topic))", updatedAt: 2 },
    other: { type: "free", scope: "project", projectId: "other", title: "Other", body: "((Topic))", updatedAt: 4 },
  };
  const modules: any = {
    "../../storage": { loadAllTodayStates: async () => [] },
    "../db/memoRepo": {}, "./researchNoteService": {},
    "../db/noteRepo": { getNoteById: async (id: string) => records[id] },
    "../db/tokenIndexRepo": { searchByToken: async () => Object.keys(records).map(id => ({ memoId: `note:${id}` })) },
    "../utils/wikiLink": { extractTokens }, "./collaboration/projectMemoAIRetrievalCore": { projectMemoEvidenceId },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/services/wikiReferenceService.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: (name: string) => modules[name] });
  return exports.listWikiReferencesByToken;
}
const shared = (id: string, projectId: string, body = "((Topic))") => ({ id, projectId, title: id, body, updatedAt: 5 });
test("Project plus Private references exclude other projects and local shared mirrors", async () => {
  const list = fixture();
  const items = await list("topic", { noteScope: "personal", projectId: "p", projectNotes: [shared("shared", "p"), shared("foreign", "other"), shared("unrelated", "p", "((Different))")] });
  assert.deepEqual(Array.from(items, (item: any) => item.memoId), [projectMemoEvidenceId("p", "shared"), "note:private"]);
  assert.equal(items[0].projectNoteId, "shared");
});
test("current Project memo is excluded; original callers retain their behavior", async () => {
  const list = fixture();
  const items = await list("Topic", { noteScope: "personal", projectId: "p", projectNotes: [shared("self", "p")], excludeMemoId: projectMemoEvidenceId("p", "self") });
  assert.deepEqual(Array.from(items, (item: any) => item.memoId), ["note:private"]);
  assert.equal((await list("Topic")).length, 3);
});

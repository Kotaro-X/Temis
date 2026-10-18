import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { projectMemoEvidenceId, projectNoteIdFromEvidence } from "../src/services/collaboration/projectMemoAIRetrievalCore.ts";
const note = (id: string) => ({ id, projectId: "p", sourceNoteId: id, ownerUserId: "alice", title: id, body: "((Topic))", updatedAt: 1 });
function fixture(initial: any = note("root")) {
  const slots: any[] = []; let cursor = 0; let closed = 0;
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (value: any) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
  };
  const exports: any = {};
  const code = ts.transpileModule(readFileSync("src/components/memo/ProjectMemoDetail.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return react;
    if (name.endsWith("projectMemoAIRetrievalCore")) return { projectMemoEvidenceId, projectNoteIdFromEvidence };
    return { __esModule: true, default: name };
  } });
  const flatten = (tree: any): any[] => !tree || typeof tree !== "object" ? [] : [tree, ...(tree.props?.children ?? []).flatMap((child: any) => Array.isArray(child) ? child.flatMap(flatten) : flatten(child))];
  const render = () => { cursor = 0; const tree = exports.default({ initialNote: initial, project: { id: "p" }, language: "ja", tasks: [], onChanged: () => {}, onBack: () => { closed++; } }); const nodes = flatten(tree); return {
    session: nodes.find(node => typeof node.type === "function" && node.type.name === "ProjectMemoSession").props,
    privateScreen: nodes.find(node => typeof node.type === "string" && node.type.endsWith("MemoDetailScreen"))?.props,
  }; };
  return { render, closed: () => closed };
}
function select(session: any, id: string) { session.onSelect({ memoId: projectMemoEvidenceId("p", id), projectNoteId: id, projectNote: note(id) }, note(session.initialNote?.id ?? "created"), "Topic", "note"); }
test("multi-hop Project references restore each memo identity and reference filter", () => {
  const f = fixture(); select(f.render().session, "A"); const a = f.render(); select(a.session, "B");
  f.render().session.onBack(); const returned = f.render(); assert.equal(returned.session.key, "A"); assert.equal(returned.session.initialNote.id, "A"); assert.equal(returned.session.initialFilter, "note");
  returned.session.onBack(); assert.equal(f.render().session.initialNote.id, "root"); f.render().session.onBack(); assert.equal(f.closed(), 1);
});
test("first autosave does not remount or close a new memo editor", () => {
  const f = fixture(null); const initial = f.render().session; initial.onSaved(note("created"));
  assert.equal(f.render().session.key, initial.key); assert.equal(f.render().session.initialNote.id, "created");
});
test("Project to Private to Project restores the Private reference context", () => {
  const f = fixture(); f.render().session.onSelect({ memoId: "note:private" }, note("root"), "Topic", "note");
  const privateView = f.render().privateScreen; assert.equal(privateView.referenceProjectId, "p");
  privateView.onSelectProjectReference(note("B"), "Topic", "note", "note:private");
  assert.equal(f.render().session.initialNote.id, "B"); f.render().session.onBack();
  const returned = f.render().privateScreen; assert.equal(returned.memoId, "note:private"); assert.equal(returned.initialReferenceToken, "Topic"); assert.equal(returned.initialReferenceFilter, "note");
});

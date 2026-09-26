import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { URL } from "node:url";
import ts from "typescript";
import { createRequire } from "node:module";
import * as labels from "../src/services/aiEvidence.ts";
import * as guardrails from "../src/services/answerGuardrails.ts";
import * as wiki from "../src/utils/wikiLink.ts";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
function loadModule(path: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(code, { exports, console, process: { env: {} }, require: (name: string) => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}

test("real token-index queries bound distinct IDs, exclude visited docs and load complete Wiki tokens", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE token_index (memo_id TEXT, token TEXT, updated_at INTEGER)");
  const insert = db.prepare("INSERT INTO token_index VALUES (?, ?, ?)");
  for (let n = 0; n < 400; n++) insert.run(`m${n}`, "医療", n);
  insert.run("multi", "医療", 0); insert.run("multi", "風の谷", 0);
  const repo = loadModule("../src/db/tokenIndexRepo.ts", {
    "nanoid/non-secure": {}, "../utils/wikiLink": wiki,
    "./sqlite": { ensureDbReady: async () => {}, executeSql: async (sql: string, args: unknown[]) => ({ rows: { _array: db.prepare(sql).all(...args) } }) },
  });
  try {
    const ids = await repo.findWikiLinkedMemoIds(["医療", "風の谷"], ["m399"]);
    assert.equal(ids.length, 300);
    assert.equal(ids[0], "multi");
    assert.equal(ids[1], "m398");
    assert.ok(!ids.includes("m399"));
    const tokens = await repo.getTokensByMemoIds(["multi", "m0", "missing"]);
    assert.deepEqual(Array.from(tokens.get("multi")), ["医療", "風の谷"]);
    assert.equal(tokens.has("missing"), false);
  } finally { db.close(); }
});

function answerFixture(generated: { answerText: string; citedEvidenceKeys: string[] }) {
  let sent: any = null;
  const service = loadModule("../src/services/answerWithCitations.ts", {
    "./aiEvidence": labels,
    "./LLMProvider": { getLLMProvider: () => ({}) },
    "./answerGuardrails": guardrails,
    "./llmSettings": { getLLMRuntimeConfig: () => ({ provider: "openai", openAiFunctionRegion: "asia-northeast1" }) },
    "./openAIGroundedAnswerCallable": { requestOpenAIGroundedAnswer: async (request: unknown) => { sent = request; return generated; } },
  });
  return { service, getSent: () => sent };
}
const evidence = () => Array.from({ length: 15 }, (_, n) => ({
  memoId: `memo${n}`, chunkId: `chunk${n}`, snippetText: `根拠${n}の具体的な内容です。`, createdAt: 0,
  score: n, tokensHit: Array(n).fill("医療"), linkDepth: n ? 2 : 0, linkPath: n ? ["風の谷", "医療"] : [],
}));

test("client sends all 15 memos in retrieval order and E15 opens the same selected memo", async () => {
  const f = answerFixture({ answerText: "医療へのアクセスに関する記録があります。", citedEvidenceKeys: ["E15"] });
  const selected = labels.labelAnswerEvidence(evidence());
  const answer = await f.service.answerWithCitations("田舎を発展させるには", selected);
  assert.equal(f.getSent().evidence.length, 15);
  assert.equal(f.getSent().evidence[14].key, "E15");
  assert.equal(f.getSent().evidence[14].text, selected[14].snippetText);
  assert.deepEqual(Array.from(answer.citedEvidenceKeys), ["E15"]);
  assert.equal(selected.find((e) => answer.citedEvidenceKeys.includes(e.key))?.memoId, "memo14");
});

test("invalid answers use citations for the actual fallback blocks, and empty evidence makes no request", async () => {
  const f = answerFixture({ answerText: "。。。", citedEvidenceKeys: ["E1"] });
  const answer = await f.service.answerWithCitations("質問", evidence());
  assert.ok(answer.citedEvidenceKeys.includes("E15"));
  assert.ok(!answer.citedEvidenceKeys.includes("E1"));
  for (const key of answer.citedEvidenceKeys) {
    const index = Number(key.slice(1)) - 1;
    assert.ok(answer.answerText.includes(`根拠${index}`));
  }
  const empty = answerFixture({ answerText: "unused", citedEvidenceKeys: [] });
  const result = await empty.service.answerWithCitations("質問", []);
  assert.equal(result.citedEvidenceKeys.length, 0);
  assert.equal(empty.getSent(), null);
});

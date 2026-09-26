import test from "node:test";
import assert from "node:assert/strict";
import { retrieveWikiAnswerEvidence, buildWikiAnswerExcerpt, type WikiAnswerDocument } from "../src/services/wikiAnswerRetrievalCore.ts";
import { labelAnswerEvidence } from "../src/services/aiEvidence.ts";
import { extractTokens } from "../src/utils/wikiLink.ts";

const doc = (memoId: string, body: string, semanticScore = 0, updatedAt = 1): WikiAnswerDocument =>
  ({ memoId, body, tokens: extractTokens(body), semanticScore, updatedAt });
const fixture = (documents: WikiAnswerDocument[]) => {
  const loaded: string[] = [];
  const expanded: string[][] = [];
  return { loaded, expanded, deps: {
    loadDocuments: async (ids: string[]) => {
      loaded.push(...ids);
      return ids.flatMap((id) => documents.filter((d) => d.memoId === id));
    },
    findLinkedMemoIds: async (tokens: string[], exclude: string[]) => {
      expanded.push(tokens);
      return documents.filter((d) => !exclude.includes(d.memoId) && d.tokens.some((t) => tokens.includes(t))).map((d) => d.memoId);
    },
  } };
};

test("follows the valley/medicine chain through 3 hops, excludes hop 4 and unrelated memos", async () => {
  const f = fixture([
    doc("a", "田舎を発展させる。（（風の谷））", 0.9),
    doc("note:b", "((風の谷)) では ((医療)) を考える。"),
    doc("tankyu:c", "((医療)) のために ((交通)) が必要。"),
    doc("d", "((交通)) を ((技術)) で改善する。"),
    doc("e", "((技術)) の話。"), doc("unrelated", "都会のイベント。", 1),
  ]);
  const result = await retrieveWikiAnswerEvidence("田舎を発展させるには", ["a"], f.deps);
  assert.deepEqual(result.map((r) => r.memoId), ["a", "note:b", "tankyu:c", "d"]);
  assert.deepEqual(result[3].linkPath, ["風の谷", "医療", "交通"]);
  assert.deepEqual(result.map((r) => r.linkDepth), [0, 1, 2, 3]);
  assert.equal(f.expanded.length, 3);
});

test("cycles and multiple paths never duplicate evidence and retain 4 distinct seeds", async () => {
  const f = fixture([
    doc("a", "((x)) ((y))"), doc("b", "((y))"), doc("c", "((z))"), doc("d", "((z))"),
    doc("multi", "((x)) ((y)) ((z))"), doc("single", "((x))", 0.99),
  ]);
  const result = await retrieveWikiAnswerEvidence("質問", ["a", "a", "b", "c", "d"], f.deps);
  assert.deepEqual(result.slice(0, 4).map((r) => r.memoId), ["a", "b", "c", "d"]);
  assert.equal(new Set(result.map((r) => r.memoId)).size, result.length);
  assert.equal(result[4].memoId, "multi");
  assert.equal(new Set(f.loaded).size, f.loaded.length);
});

test("candidate and answer budgets remain bounded on a large hub", async () => {
  const f = fixture([doc("seed", "((hub))"), ...Array.from({ length: 1000 }, (_, n) => doc(`m${n}`, `((hub)) ((next${n}))`))]);
  const result = await retrieveWikiAnswerEvidence("質問", ["seed"], f.deps);
  assert.equal(result.length, 15);
  assert.equal(f.loaded.length, 300);
  assert.ok(f.expanded[1].length <= 30);
  assert.equal(result[0].memoId, "seed");
});

test("skips missing/blank documents and accepts linked text without embeddings", async () => {
  const f = fixture([doc("seed", "((医療))"), doc("empty", " "), doc("pending", "((医療)) 巡回診療を行う。")]);
  const result = await retrieveWikiAnswerEvidence("質問", ["deleted", "empty", "seed"], f.deps);
  assert.deepEqual(result.map((r) => r.memoId), ["seed", "pending"]);
  assert.deepEqual(await retrieveWikiAnswerEvidence("質問", [], f.deps), []);
});

test("extracts later Wiki links and semantic content within a 1200-character budget", async () => {
  const body = "前置き。".repeat(1000) + "（（医療））巡回診療で地域を支える。" + "補足。".repeat(1000);
  const f = fixture([doc("seed", body), doc("linked", "((医療)) 医師を確保する。")]);
  const result = await retrieveWikiAnswerEvidence("田舎", ["seed"], f.deps);
  assert.equal(result.length, 2);
  assert.ok(result[0].snippetText.includes("巡回診療"));
  assert.ok(result[0].snippetText.length <= 1200);
  const excerpt = buildWikiAnswerExcerpt(body, "地域を支えるには", [], "巡回診療で地域を支える。");
  assert.ok(excerpt.includes("巡回診療"));
});

test("ranks multiple roots above semantic similarity, then uses deterministic ties", async () => {
  const f = fixture([
    doc("a", "((x))"), doc("b", "((y))"),
    doc("both", "((x)) ((y))", 0), doc("one", "((x))", 0.99),
    doc("tie-b", "((y))", 0.5, 10), doc("tie-a", "((y))", 0.5, 10),
  ]);
  const result = await retrieveWikiAnswerEvidence("質問", ["a", "b"], f.deps);
  assert.equal(result[2].memoId, "both");
  assert.ok(result.findIndex((r) => r.memoId === "tie-a") < result.findIndex((r) => r.memoId === "tie-b"));
});

test("evidence labels preserve retrieval order and map E15 to the selected memo", () => {
  const input = Array.from({ length: 20 }, (_, n) => ({ memoId: `m${n}`, chunkId: `c${n}`, snippetText: `根拠${n}`, createdAt: 0, score: n, tokensHit: Array(n).fill("token") }));
  const labeled = labelAnswerEvidence([input[0], input[0], ...input.slice(1)]);
  assert.equal(labeled.length, 15);
  assert.equal(labeled[14].key, "E15");
  assert.equal(labeled[14].evidenceKey, "E15");
  assert.equal(labeled[14].memoId, "m14");
  assert.deepEqual(labelAnswerEvidence(labeled).map((e) => e.key), labeled.map((e) => e.key));
});

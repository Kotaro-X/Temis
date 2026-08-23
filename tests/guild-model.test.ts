import assert from "node:assert/strict";
import test from "node:test";

import {
  extractGuildTags,
  normalizeGuildTag,
  normalizeGuildTags,
  validateGuildPostInput,
} from "../src/types/guild.ts";

test("Guild tags are normalized, deduplicated, and capped at five", () => {
  assert.equal(normalizeGuildTag("  React Ｎative "), "react native");
  assert.deepEqual(
    normalizeGuildTags([" React ", "react", "Design", "a", "b", "c", "d"]),
    ["react", "design", "a", "b", "c"],
  );
});

test("Guild tags are extracted from #tags in the memo body", () => {
  assert.deepEqual(
    extractGuildTags("#React #react ＃デザイン ((関連ノート)) C#"),
    ["react", "デザイン"],
  );
});

test("Guild posts need a body and project for project post kinds", () => {
  const base = { body: "活動報告 #開発", type: "personal" as const, projectId: null, source: { scope: "personal" as const, memoId: "m1" } };
  assert.equal(validateGuildPostInput(base), null);
  assert.match(validateGuildPostInput({ ...base, body: "" }) ?? "", /本文/);
  assert.equal(validateGuildPostInput({ ...base, body: "タグなし" }), null);
  assert.match(validateGuildPostInput({ ...base, type: "project_activity", projectId: null }) ?? "", /プロジェクト/);
});

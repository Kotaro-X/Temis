import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const guildAI = require("../functions/guildAICore.cjs") as {
  buildGuildIndexText: (post: unknown) => string;
  isActiveFreeGrant: (grant: unknown, now?: number) => boolean;
  isPublicVisibleGuildPost: (post: unknown) => boolean;
  toSafeGuildEvidencePost: (id: string, post: Record<string, unknown>) => Record<string, unknown>;
};

test("Guild AI indexes only public visible posts", () => {
  const visible = { status: "published", moderation: { visibility: "visible" } };
  assert.equal(guildAI.isPublicVisibleGuildPost(visible), true);
  assert.equal(guildAI.isPublicVisibleGuildPost({ ...visible, status: "unpublished" }), false);
  assert.equal(guildAI.isPublicVisibleGuildPost({ ...visible, moderation: { visibility: "hidden" } }), false);
});

test("Guild AI evidence never exposes source or private memo ids", () => {
  const post = guildAI.toSafeGuildEvidencePost("post-1", {
    authorUserId: "author-1",
    authorDisplayName: "Alice",
    title: "公開タイトル",
    body: "公開本文",
    publishedAt: 123,
    source: { scope: "personal", memoId: "private-memo-1" },
  });
  assert.deepEqual(Object.keys(post).sort(), [
    "authorDisplayName",
    "authorUserId",
    "body",
    "id",
    "publishedAt",
    "title",
  ]);
  assert.equal(JSON.stringify(post).includes("private-memo-1"), false);
});

test("Guild AI free grants allow only active staff_free and invite_free", () => {
  const now = 1_000;
  assert.equal(guildAI.isActiveFreeGrant({ active: true, grantType: "staff_free", expiresAt: null }, now), true);
  assert.equal(guildAI.isActiveFreeGrant({ active: true, grantType: "invite_free", expiresAt: 2_000 }, now), true);
  assert.equal(guildAI.isActiveFreeGrant({ active: true, grantType: "invite_discount", expiresAt: null }, now), false);
  assert.equal(guildAI.isActiveFreeGrant({ active: true, grantType: "invite_free", expiresAt: 999 }, now), false);
});

const GUILD_INDEX_COLLECTION = "guildPostAIIndex";
const MAX_GUILD_QUESTION_CHARS = 1_000;
const MAX_GUILD_EVIDENCE = 15;

const toMillis = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return null;
};

const isPublicVisibleGuildPost = (post) =>
  post?.status === "published" && post?.moderation?.visibility === "visible";

const buildGuildIndexText = (post) => {
  const title = typeof post?.title === "string" ? post.title.trim() : "";
  const body = typeof post?.body === "string" ? post.body.trim() : "";
  return [title, body].filter(Boolean).join("\n").slice(0, 4_000);
};

const toSafeGuildEvidencePost = (id, post) => ({
  id,
  authorUserId: typeof post.authorUserId === "string" ? post.authorUserId : "",
  authorDisplayName:
    typeof post.authorDisplayName === "string" ? post.authorDisplayName : "",
  title: typeof post.title === "string" ? post.title : null,
  body: typeof post.body === "string" ? post.body : "",
  publishedAt: toMillis(post.publishedAt),
});

const readGuildQuestion = (data) => {
  const question = typeof data?.question === "string"
    ? data.question.replace(/\s+/g, " ").trim()
    : "";
  if (!question || question.length > MAX_GUILD_QUESTION_CHARS) return null;
  return question;
};

const isActiveFreeGrant = (grant, now = Date.now()) => {
  const expiresAt = toMillis(grant?.expiresAt);
  return grant?.active === true &&
    (grant.grantType === "staff_free" || grant.grantType === "invite_free") &&
    (expiresAt === null || expiresAt > now);
};

module.exports = {
  GUILD_INDEX_COLLECTION,
  MAX_GUILD_EVIDENCE,
  buildGuildIndexText,
  isActiveFreeGrant,
  isPublicVisibleGuildPost,
  readGuildQuestion,
  toMillis,
  toSafeGuildEvidencePost,
};

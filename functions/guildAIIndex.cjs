const { createHash } = require("node:crypto");
const { isPublicVisibleGuildPost, buildGuildIndexText, toMillis } = require("./guildAICore.cjs");

const GUILD_INDEX_VERSION = 2;
const hashWikiToken = (token) => createHash("sha256").update(token).digest("hex");
const extractGuildWikiTokens = (post) => {
  const text = [post?.title, post?.body].filter((value) => typeof value === "string").join("\n")
    .replace(/（/g, "(").replace(/）/g, ")");
  return Array.from(new Set(Array.from(text.matchAll(/\(\((.*?)\)\)/g))
    .map((match) => match[1].trim()).filter(Boolean)));
};
// Firestore's revision includes nanoseconds; edited posts must never receive stale vectors.
const sourceRevision = (snapshot) => snapshot.updateTime
  ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : "";

const createGuildIndexWriter = ({ db, FieldValue, requestEmbeddings, embeddingModel }) => async (postId) => {
  const postRef = db.collection("guildPosts").doc(postId);
  const indexRef = db.collection("guildPostAIIndex").doc(postId);
  const prepared = await db.runTransaction(async (transaction) => {
    const [snapshot, indexed] = await Promise.all([transaction.get(postRef), transaction.get(indexRef)]);
    const post = snapshot.data();
    const text = buildGuildIndexText(post);
    if (!snapshot.exists || !isPublicVisibleGuildPost(post) || !text) {
      transaction.delete(indexRef);
      return null;
    }
    const revision = sourceRevision(snapshot);
    const contentHash = hashWikiToken(text);
    const old = indexed.data();
    const reuse = old?.embedding && old.embeddingModel === embeddingModel &&
      old.embeddingContentHash === contentHash && old.embeddingStatus === "completed";
    const wikiTokens = Array.from(new Set(extractGuildWikiTokens(post)));
    transaction.set(indexRef, {
      postId, indexVersion: GUILD_INDEX_VERSION,
      status: "published", moderationVisibility: "visible",
      sourceRevision: revision, sourceUpdatedAt: toMillis(post.updatedAt) ?? 0,
      publishedAt: toMillis(post.publishedAt) ?? 0,
      wikiTokens, wikiTokenHashes: wikiTokens.map(hashWikiToken),
      embeddingModel, embeddingContentHash: contentHash,
      embeddingStatus: reuse ? "completed" : "pending",
      ...(reuse ? { embedding: old.embedding } : {}),
    });
    return { text, revision, reuse: !!reuse };
  });
  if (!prepared) return false;
  if (prepared.reuse) return true;
  // Wiki links are committed before calling OpenAI. Failed embeddings do not
  // prevent linked posts from being discovered, and event retries can repair them.
  const [embedding] = await requestEmbeddings([prepared.text]);
  return db.runTransaction(async (transaction) => {
    const [snapshot, indexed] = await Promise.all([transaction.get(postRef), transaction.get(indexRef)]);
    if (!isPublicVisibleGuildPost(snapshot.data()) || sourceRevision(snapshot) !== prepared.revision ||
        indexed.data()?.sourceRevision !== prepared.revision) return false;
    transaction.update(indexRef, { embedding: FieldValue.vector(embedding), embeddingStatus: "completed" });
    return true;
  });
};

module.exports = { GUILD_INDEX_VERSION, hashWikiToken, extractGuildWikiTokens, sourceRevision, createGuildIndexWriter };

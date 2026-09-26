const { retrieveWikiAnswerEvidence } = require("./wikiAnswerRetrievalCore.cjs");
const { isPublicVisibleGuildPost, toSafeGuildEvidencePost, toMillis } = require("./guildAICore.cjs");
const { GUILD_INDEX_VERSION, hashWikiToken, extractGuildWikiTokens, sourceRevision } = require("./guildAIIndex.cjs");

const cosine = (left, right) => {
  if (!right || right.length !== left.length) return 0;
  let dot = 0, a = 0, b = 0;
  for (let i = 0; i < left.length; i++) { dot += left[i] * right[i]; a += left[i] ** 2; b += right[i] ** 2; }
  return a && b ? dot / Math.sqrt(a * b) : 0;
};

const retrieveGuildAnswer = async ({ db, FieldValue, HttpsError, uid, question, queryEmbedding, hasBlockedConnection }) => {
  const indexCollection = db.collection("guildPostAIIndex");
  const visibleIndex = () => indexCollection.where("status", "==", "published").where("moderationVisibility", "==", "visible");
  const indexCache = new Map();
  const postCache = new Map();
  const revisions = new Map();
  const documentsById = new Map();
  const examinedIds = new Set();
  const blockedCache = new Map();
  const isBlocked = (author) => {
    if (!blockedCache.has(author)) blockedCache.set(author, hasBlockedConnection(uid, author));
    return blockedCache.get(author);
  };
  const ready = await visibleIndex().where("indexVersion", "==", GUILD_INDEX_VERSION).limit(1).get();
  const nearest = await visibleIndex().findNearest({
    vectorField: "embedding", queryVector: FieldValue.vector(queryEmbedding),
    limit: 60, distanceMeasure: "COSINE",
  }).get();
  if (ready.empty || nearest.empty) {
    const publicPosts = await db.collection("guildPosts").where("status", "==", "published")
      .where("moderation.visibility", "==", "visible").limit(1).get();
    if (!publicPosts.empty) throw new HttpsError("failed-precondition", "Temis AI search index is not ready.");
    return { evidence: [], posts: [], revalidate: async () => {} };
  }
  for (const document of nearest.docs) indexCache.set(document.id, document.data());
  const loadDocuments = async (ids) => {
    const fresh = Array.from(new Set(ids)).filter((id) => !examinedIds.has(id)).slice(0, 300 - examinedIds.size);
    fresh.forEach((id) => examinedIds.add(id));
    const snapshots = fresh.length ? await db.getAll(...fresh.map((id) => db.collection("guildPosts").doc(id))) : [];
    const documents = await Promise.all(snapshots.map(async (snapshot) => {
      const post = snapshot.data();
      if (!snapshot.exists || !isPublicVisibleGuildPost(post) || typeof post.authorUserId !== "string" ||
          await isBlocked(post.authorUserId)) return null;
      const index = indexCache.get(snapshot.id);
      const revision = sourceRevision(snapshot);
      const vector = index?.sourceRevision === revision && index?.embeddingModel === "text-embedding-3-small" && index?.embedding?.toArray ? index.embedding.toArray() : null;
      const body = [post.title, post.body].filter((text) => typeof text === "string").join("\n");
      if (!body.trim()) return null;
      postCache.set(snapshot.id, toSafeGuildEvidencePost(snapshot.id, post));
      revisions.set(snapshot.id, revision);
      return { memoId: snapshot.id, body, tokens: extractGuildWikiTokens(post),
        updatedAt: toMillis(post.updatedAt) ?? 0, semanticScore: cosine(queryEmbedding, vector) };
    }));
    for (const document of documents.filter(Boolean)) documentsById.set(document.memoId, document);
    return ids.flatMap((id) => documentsById.has(id) ? [documentsById.get(id)] : []);
  };
  const findLinkedMemoIds = async (tokens, excludeIds) => {
    const excluded = new Set(excludeIds);
    const candidates = new Map();
    const unique = Array.from(new Set(tokens));
    // Firestore supports at most 30 values in array-contains-any. Bound both
    // returned documents and unique candidates for large/high-degree topics.
    for (let offset = 0; offset < unique.length && candidates.size < 300; offset += 30) {
      const batch = unique.slice(offset, offset + 30);
      const snapshot = await visibleIndex().where("wikiTokenHashes", "array-contains-any", batch.map(hashWikiToken))
        .orderBy("sourceUpdatedAt", "desc").limit(300).get();
      for (const document of snapshot.docs) {
        if (excluded.has(document.id)) continue;
        const index = document.data();
        indexCache.set(document.id, index);
        candidates.set(document.id, index);
        if (candidates.size >= 300) break;
      }
    }
    const tokenSet = new Set(unique);
    const count = (index) => (index.wikiTokens ?? []).filter((token) => tokenSet.has(token)).length;
    return Array.from(candidates).sort(([aId, a], [bId, b]) => count(b) - count(a) ||
      b.sourceUpdatedAt - a.sourceUpdatedAt || aId.localeCompare(bId)).map(([id]) => id);
  };
  const initialDocuments = await loadDocuments(nearest.docs.map((doc) => doc.id));
  const floor = Math.max(0.12, ...initialDocuments.map((doc) => doc.semanticScore * 0.82));
  const seedIds = initialDocuments.filter((doc) => doc.semanticScore >= floor)
    .sort((a, b) => b.semanticScore - a.semanticScore || a.memoId.localeCompare(b.memoId)).map((doc) => doc.memoId);
  const evidence = await retrieveWikiAnswerEvidence(question, seedIds, { loadDocuments, findLinkedMemoIds });
  const sourceIds = Array.from(new Set(evidence.flatMap((item) => item.sourceDocumentIds)));
  const revalidate = async () => {
    if (!sourceIds.length) return;
    const snapshots = await db.getAll(...sourceIds.map((id) => db.collection("guildPosts").doc(id)));
    const blocked = new Map();
    for (const snapshot of snapshots) {
      const post = snapshot.data();
      if (!snapshot.exists || !isPublicVisibleGuildPost(post) || sourceRevision(snapshot) !== revisions.get(snapshot.id)) {
        throw new HttpsError("aborted", "Referenced posts have changed. Please retry.");
      }
      if (!blocked.has(post.authorUserId)) blocked.set(post.authorUserId, await hasBlockedConnection(uid, post.authorUserId));
      if (blocked.get(post.authorUserId)) throw new HttpsError("aborted", "Referenced posts have changed. Please retry.");
    }
  };
  return {
    evidence,
    posts: evidence.map((item) => ({ ...postCache.get(item.memoId), linkDepth: item.linkDepth,
      linkPath: item.linkPath, snippetText: item.snippetText })),
    revalidate,
  };
};
module.exports = { retrieveGuildAnswer };

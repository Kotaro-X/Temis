#!/usr/bin/env node
// Administrative migration only. Uses the existing Firebase CLI account and
// never writes credentials, API keys, or post bodies to stdout or disk.
const { requireAuth } = require("firebase-tools/lib/requireAuth");
const cliAuth = require("firebase-tools/lib/auth");
const { Client, getAccessToken } = require("firebase-tools/lib/apiv2");
const { OAuth2Client } = require("google-auth-library");
const { Firestore, FieldValue, FieldPath } = require("@google-cloud/firestore");
const { createGuildIndexWriter } = require("../functions/guildAIIndex.cjs");

async function main() {
  const [command, projectId] = process.argv.slice(2);
  if (!["repair-invoker", "backfill", "status"].includes(command) || !/^[a-z][a-z0-9-]+$/.test(projectId ?? "")) {
    throw new Error("Usage: node scripts/guild-ai-maintenance.cjs <status|repair-invoker|backfill> <projectId>");
  }
  await requireAuth({ project: projectId, ...cliAuth.getGlobalDefaultAccount() });
  if (command === "repair-invoker") {
    const functions = new Client({ urlPrefix: "https://cloudfunctions.googleapis.com", apiVersion: "v2" });
    const fn = (await functions.get(`/projects/${projectId}/locations/asia-northeast1/functions/indexGuildPostForAISearch`)).body;
    const principal = fn.eventTrigger?.serviceAccountEmail;
    const service = fn.serviceConfig?.service;
    if (!principal || !service) throw new Error("Function event identity or Cloud Run service is missing.");
    const run = new Client({ urlPrefix: "https://run.googleapis.com", apiVersion: "v2" });
    const policy = (await run.get(`/${service}:getIamPolicy`)).body;
    const member = `serviceAccount:${principal}`;
    const binding = (policy.bindings ?? []).find((item) => item.role === "roles/run.invoker" && !item.condition);
    if (!binding?.members?.includes(member)) {
      policy.bindings ??= [];
      if (binding) binding.members.push(member);
      else policy.bindings.push({ role: "roles/run.invoker", members: [member] });
      await run.post(`/${service}:setIamPolicy`, { policy });
    }
    console.log(JSON.stringify({ service, invoker: member, publicAccessAdded: false }));
    return;
  }
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: await getAccessToken(), expiry_date: Date.now() + 50 * 60_000 });
  const db = new Firestore({ projectId, authClient });
  try {
    if (command === "status") {
      const [posts, index] = await Promise.all([
        db.collection("guildPosts").select("status", "moderation").get(),
        db.collection("guildPostAIIndex").select("indexVersion", "embeddingStatus").get(),
      ]);
      console.log(JSON.stringify({ posts: posts.size,
        publicVisible: posts.docs.filter((doc) => doc.data().status === "published" && doc.data().moderation?.visibility === "visible").length,
        indexed: index.size, version2: index.docs.filter((doc) => doc.data().indexVersion === 2).length,
        embedded: index.docs.filter((doc) => doc.data().embeddingStatus === "completed").length,
      }));
      return;
    }
    const secretResponse = await fetch(`https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/OPENAI_API_KEY/versions/latest:access`, {
      headers: { Authorization: `Bearer ${await getAccessToken()}` }, signal: AbortSignal.timeout(30_000),
    });
    if (!secretResponse.ok) throw new Error(`Secret access failed (${secretResponse.status}).`);
    const secret = await secretResponse.json();
    const apiKey = Buffer.from(secret.payload.data, "base64").toString("utf8").trim();
    const requestEmbeddings = async (input) => {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input }), signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`Embedding request failed (${response.status}).`);
      const body = await response.json();
      const vectors = body.data?.map((item) => item.embedding);
      if (!Array.isArray(vectors) || vectors.length !== input.length || vectors.some((v) => !Array.isArray(v) || v.length !== 1536 || v.some((n) => !Number.isFinite(n)))) {
        throw new Error("Invalid embedding response.");
      }
      return vectors;
    };
    const write = createGuildIndexWriter({ db, FieldValue, requestEmbeddings, embeddingModel: "text-embedding-3-small" });
    let cursor = null, processed = 0, indexed = 0, failed = 0;
    do {
      authClient.setCredentials({ access_token: await getAccessToken(), expiry_date: Date.now() + 50 * 60_000 });
      let query = db.collection("guildPosts").orderBy(FieldPath.documentId()).limit(20);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const post of page.docs) {
        processed++;
        try { if (await write(post.id)) indexed++; }
        catch { failed++; console.error(JSON.stringify({ failedPostId: post.id })); }
      }
      cursor = page.size === 20 ? page.docs[page.size - 1].id : null;
      console.log(JSON.stringify({ processed, indexed, failed, nextCursor: cursor }));
    } while (cursor);
    if (failed) process.exitCode = 1;
  } finally { await db.terminate(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });

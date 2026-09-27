// Narrow, secret-safe production inspection and additive index provisioning.
const { requireAuth } = require("firebase-tools/lib/requireAuth");
const cliAuth = require("firebase-tools/lib/auth");
const { Client, getAccessToken } = require("firebase-tools/lib/apiv2");
const { readFileSync } = require("node:fs");
const names = ["refreshTemisAccess", "refreshProjectAccess", "createProjectWithQuota", "respondToProjectInvitationWithQuota", "createProjectJoinRequestWithQuota", "respondToProjectJoinRequestWithQuota", "beginFreeProjectSelection", "resolveProjectOverflow", "getTemisAIUsage", "beginTemisAIUsage", "cancelTemisAIUsage", "completeTemisAIUsage", "generateGroundedAnswer", "searchGuildPostsWithAI"];
async function main() {
  const [command, projectId] = process.argv.slice(2);
  if (!["status", "ensure-indexes", "probe", "verify-backfill"].includes(command) || projectId !== "temis-c05aa") throw new Error("Invalid maintenance target");
  if (command === "probe") {
    for (const name of names) {
      const response = await fetch(`https://asia-northeast1-${projectId}.cloudfunctions.net/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: {} }), signal: AbortSignal.timeout(30000) });
      const result = await response.json().catch(() => null);
      const status = result?.error?.status;
      console.log(JSON.stringify({ name, http: response.status, status }));
      if (response.status !== 401 || status !== "UNAUTHENTICATED") process.exitCode = 1;
    }
    return;
  }
  await requireAuth({ project: projectId, ...cliAuth.getGlobalDefaultAccount() });
  if (command === "verify-backfill") {
    const { OAuth2Client } = require("google-auth-library");
    const { Firestore } = require("@google-cloud/firestore");
    const authClient = new OAuth2Client();
    authClient.setCredentials({ access_token: await getAccessToken(), expiry_date: Date.now() + 50 * 60_000 });
    const db = new Firestore({ projectId, authClient });
    try {
      const [access, states, memberships, grants] = await Promise.all(["temisAccessStates", "projectAccessStates", "projectMemberships", "subscriptionAccess"].map((name) => db.collection(name).get()));
      const grantMap = new Map(grants.docs.map((doc) => [doc.id, doc.data()]));
      const expired = access.docs.filter((doc) => doc.data().verifiedUntil <= Date.now()).length;
      const overlongGrantLeases = access.docs.filter((doc) => {
        const a = doc.data(); const g = grantMap.get(doc.id);
        const expiry = typeof g?.expiresAt === "number" ? g.expiresAt : g?.expiresAt?.toMillis?.();
        return ["staff_free", "invite_free"].includes(a.source) && expiry != null && a.verifiedUntil > expiry;
      }).length;
      const mismatchedCounts = states.docs.filter((doc) => doc.data().membershipCount !== memberships.docs.filter((m) => m.data().userId === doc.id).length).length;
      const missingState = access.docs.filter((doc) => !states.docs.some((state) => state.id === doc.id)).length;
      console.log(JSON.stringify({ accessDocuments: access.size, projectStateDocuments: states.size, memberships: memberships.size, expired, overlongGrantLeases, mismatchedCounts, missingState }));
      if (expired || overlongGrantLeases || mismatchedCounts || missingState) process.exitCode = 1;
    } finally { await db.terminate(); }
    return;
  }
  const firestore = new Client({ urlPrefix: "https://firestore.googleapis.com", apiVersion: "v1" });
  const desired = JSON.parse(readFileSync(require.resolve("../firestore.indexes.json"), "utf8")).indexes.filter((index) => ["projectNotes", "projectTasks", "temisAIUsageReservations"].includes(index.collectionGroup));
  for (const spec of desired) {
    const url = `/projects/${projectId}/databases/(default)/collectionGroups/${spec.collectionGroup}/indexes`;
    const listed = (await firestore.get(url)).body.indexes || [];
    const match = listed.find((index) => index.queryScope === spec.queryScope && JSON.stringify(index.fields.filter((field) => field.fieldPath !== "__name__")) === JSON.stringify(spec.fields));
    if (!match && command === "ensure-indexes") {
      const operation = (await firestore.post(url, { queryScope: spec.queryScope, fields: spec.fields })).body;
      console.log(JSON.stringify({ collection: spec.collectionGroup, created: true, operation: operation.name }));
    } else console.log(JSON.stringify({ collection: spec.collectionGroup, fields: spec.fields.map((f) => f.fieldPath), state: match?.state || "MISSING" }));
  }
  if (command === "ensure-indexes") return;
  const functions = new Client({ urlPrefix: "https://cloudfunctions.googleapis.com", apiVersion: "v2" });
  for (const name of names) {
    try {
      const fn = (await functions.get(`/projects/${projectId}/locations/asia-northeast1/functions/${name}`)).body;
      console.log(JSON.stringify({ name, state: fn.state, updated: fn.updateTime, account: fn.serviceConfig?.serviceAccountEmail, secrets: fn.serviceConfig?.secretEnvironmentVariables?.map((s) => ({ name: s.secret, version: s.version })) }));
    } catch (error) { console.log(JSON.stringify({ name, http: error.status || error.statusCode || null })); }
  }
  const crm = new Client({ urlPrefix: "https://cloudresourcemanager.googleapis.com", apiVersion: "v1" });
  const policy = (await crm.post(`/projects/${projectId}:getIamPolicy`, {})).body;
  console.log(JSON.stringify({ runtimeRoles: (policy.bindings || []).filter((b) => b.members?.includes(`serviceAccount:temis-embeddings@${projectId}.iam.gserviceaccount.com`)).map((b) => b.role) }));
}
main().catch((error) => { console.error("Freemium maintenance failed", error.status || error.code || error.name); process.exitCode = 1; });

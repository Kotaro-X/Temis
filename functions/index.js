import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import accountDeletion from "./accountDeletion.cjs";
import profileIdentity from "./profileIdentity.cjs";
import guildPublication from "./guildPublication.cjs";
import directMessages from "./directMessages.cjs";
import groundedAnswerCore from "./groundedAnswerCore.cjs";
import guildAICore from "./guildAICore.cjs";
import guildAIIndex from "./guildAIIndex.cjs";
import guildAIRetrieval from "./guildAIRetrieval.cjs";
import projectAccessCore from "./projectAccessCore.cjs";
import temisAccessCore from "./temisAccessCore.cjs";

export const updateGuildPublication = guildPublication.updateGuildPublication;

export const syncProfileIdentity = profileIdentity.syncProfileIdentity;
export const cleanupProfilePhotos = profileIdentity.cleanupProfilePhotos;

export const deleteAccount = accountDeletion.deleteAccount;
export const getAccountDeletionBlockers = accountDeletion.getAccountDeletionBlockers;
export const resolveAccountDeletionBlocker = accountDeletion.resolveAccountDeletionBlocker;

const openAiApiKey = defineSecret("OPENAI_API_KEY");
const revenueCatProjectId = defineSecret("REVENUECAT_PROJECT_ID");
const revenueCatV2SecretApiKey = defineSecret("REVENUECAT_V2_SECRET_API_KEY");
const revenueCatCloudSyncEntitlementId = defineSecret(
  "REVENUECAT_CLOUD_SYNC_ENTITLEMENT_ID",
);
// The project has no Compute Engine default service account. Use a dedicated,
// least-privilege runtime identity instead of enabling a broad default account.
const EMBEDDING_RUNTIME_SERVICE_ACCOUNT =
  "temis-embeddings@temis-c05aa.iam.gserviceaccount.com";
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_INPUTS = 20;
const MAX_INPUT_CHARS = 4_000;
const MAX_TOTAL_CHARS = 40_000;
const REGION = "asia-northeast1";
const db = getFirestore();

const {
  readGuildQuestion,
} = guildAICore;

const invalidArgument = (message) =>
  new HttpsError("invalid-argument", message);

const readInputs = (data) => {
  if (!data || typeof data !== "object" || !Array.isArray(data.input)) {
    throw invalidArgument("input must be an array of strings.");
  }
  if (data.input.length === 0 || data.input.length > MAX_INPUTS) {
    throw invalidArgument(`input must contain 1 to ${MAX_INPUTS} strings.`);
  }

  let totalChars = 0;
  const inputs = data.input.map((value) => {
    if (typeof value !== "string") {
      throw invalidArgument("input must contain only strings.");
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_INPUT_CHARS) {
      throw invalidArgument(
        `Each input must contain 1 to ${MAX_INPUT_CHARS} characters.`,
      );
    }
    totalChars += normalized.length;
    return normalized;
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw invalidArgument(
      `The combined input must not exceed ${MAX_TOTAL_CHARS} characters.`,
    );
  }
  return inputs;
};

const readEmbeddingResponse = (body, expectedCount) => {
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
    throw new HttpsError("internal", "Embedding response was invalid.");
  }
  const ordered = [...body.data].sort((left, right) => {
    const leftIndex = Number.isInteger(left?.index) ? left.index : -1;
    const rightIndex = Number.isInteger(right?.index) ? right.index : -1;
    return leftIndex - rightIndex;
  });
  const embeddings = ordered.map((item) => item?.embedding);
  if (
    embeddings.length !== expectedCount ||
    ordered.some((item, index) => item?.index !== index) ||
    embeddings.some(
      (vector) =>
        !Array.isArray(vector) ||
        vector.length === 0 ||
        vector.some((value) => typeof value !== "number" || !Number.isFinite(value)),
    )
  ) {
    throw new HttpsError("internal", "Embedding response was invalid.");
  }
  return embeddings;
};

const mapOpenAIError = (error, operation) => {
  if (error instanceof HttpsError) return error;
  if (error?.status === 429) {
    return new HttpsError("resource-exhausted", `${operation} is temporarily busy. Please try again shortly.`);
  }
  if (typeof error?.status === "number" && error.status >= 500) {
    return new HttpsError("unavailable", `${operation} is temporarily unavailable.`);
  }
  if (error?.code === "invalid-argument") {
    return new HttpsError("invalid-argument", error.message);
  }
  if (error?.code === "invalid-response") {
    return new HttpsError("unavailable", `${operation} returned an invalid response. Please retry.`);
  }
  if (error instanceof TypeError) {
    return new HttpsError("unavailable", `${operation} is temporarily unavailable.`);
  }
  return new HttpsError("failed-precondition", `${operation} is not configured correctly.`);
};

const requestEmbeddings = async (inputs) => {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });
  if (!response.ok) {
    const error = new Error("OpenAI embedding request failed.");
    error.status = response.status;
    throw error;
  }
  return readEmbeddingResponse(await response.json(), inputs.length);
};

export const createEmbeddings = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    maxInstances: 3,
    serviceAccount: EMBEDDING_RUNTIME_SERVICE_ACCOUNT,
    secrets: [openAiApiKey],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in is required to use AI memo search.",
      );
    }
    const input = readInputs(request.data);
    try {
      return { model: EMBEDDING_MODEL, embeddings: await requestEmbeddings(input) };
    } catch (error) {
      throw mapOpenAIError(error, "AI memo search");
    }
  },
);

export const generateGroundedAnswer = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    maxInstances: 3,
    serviceAccount: EMBEDDING_RUNTIME_SERVICE_ACCOUNT,
    secrets: [
      openAiApiKey,
      revenueCatProjectId,
      revenueCatV2SecretApiKey,
      revenueCatCloudSyncEntitlementId,
    ],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in is required to generate an AI answer.");
    }
    let claimed = false;
    try {
      await temisAIUsage.claim(uid, "memo", request.data?.requestId);
      claimed = true;
      const generated = await groundedAnswerCore.generateGroundedAnswer({
        apiKey: openAiApiKey.value(),
        data: request.data,
      });
      const usage = await temisAIUsage.complete(uid, request.data?.requestId);
      return { ...generated, usage };
    } catch (error) {
      if (claimed) await temisAIUsage.refund(uid, request.data?.requestId);
      throw mapOpenAIError(error, "AI answer generation");
    }
  },
);

const connectionIdFor = (left, right) => [left, right].sort().join("__");

const hasBlockedConnection = async (userId, authorUserId) => {
  if (userId === authorUserId) return false;
  const snapshot = await db.doc(`connections/${connectionIdFor(userId, authorUserId)}`).get();
  return snapshot.exists && snapshot.data()?.status === "blocked";
};

const hasRevenueCatEntitlement = async (uid) => {
  const projectId = revenueCatProjectId.value().trim();
  const apiKey = revenueCatV2SecretApiKey.value().trim();
  const entitlementId = revenueCatCloudSyncEntitlementId.value().trim();
  if (!projectId || !apiKey || !entitlementId) {
    throw new Error("RevenueCat access verification is not configured.");
  }
  const url = `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(uid)}/active_entitlements`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    const error = new Error("RevenueCat access verification failed.");
    error.status = response.status;
    throw error;
  }
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body?.items)) throw new Error("RevenueCat returned an invalid access response.");
  return body.items.some((item) => item?.entitlement_id === entitlementId);
};

const temisAccess = temisAccessCore.createTemisAccessService({
  db,
  HttpsError,
  verifyRevenueCat: hasRevenueCatEntitlement,
});
const temisAIUsage = temisAccessCore.createTemisAIUsageService({
  db,
  HttpsError,
  getAccess: temisAccess.getAccess,
});
const projectAccess = projectAccessCore.createProjectAccessService({
  db,
  HttpsError,
  getAccess: temisAccess.getAccess,
});

const ACCESS_SECRETS = [
  revenueCatProjectId,
  revenueCatV2SecretApiKey,
  revenueCatCloudSyncEntitlementId,
];
const ACCESS_RUNTIME = { serviceAccount: EMBEDDING_RUNTIME_SERVICE_ACCOUNT };

const requireAuthUid = (request, message = "Sign in is required.") => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", message);
  return uid;
};

export const refreshTemisAccess = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 30, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => temisAccess.refreshAccess(requireAuthUid(request), { force: true }),
);

export const refreshProjectAccess = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 60, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => {
    const uid = requireAuthUid(request);
    const access = await temisAccess.refreshAccess(uid, { force: true });
    return projectAccess.refresh(uid, access);
  },
);

export const createProjectWithQuota = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 60, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => projectAccess.createProject(requireAuthUid(request), request.data),
);

export const respondToProjectInvitationWithQuota = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 60, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => projectAccess.respondToInvitation(
    requireAuthUid(request),
    request.data?.invitationId,
    request.data?.accept === true,
  ),
);

export const createProjectJoinRequestWithQuota = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 30, maxInstances: 10 },
  async (request) => projectAccess.createJoinRequest(requireAuthUid(request), request.data),
);

export const respondToProjectJoinRequestWithQuota = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 60, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => projectAccess.respondToJoinRequest(
    requireAuthUid(request),
    request.data?.requestId,
    request.data?.accept === true,
  ),
);

export const beginFreeProjectSelection = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 30, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => projectAccess.beginSelection(
    requireAuthUid(request),
    request.data?.keepProjectId,
  ),
);

export const resolveProjectOverflow = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 540, maxInstances: 3, secrets: ACCESS_SECRETS },
  async (request) => projectAccess.resolveOverflow(requireAuthUid(request), request.data),
);

export const getTemisAIUsage = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 30, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => {
    const uid = requireAuthUid(request);
    const access = await temisAccess.refreshAccess(uid, { force: true });
    return temisAIUsage.getUsage(uid, access);
  },
);

export const beginTemisAIUsage = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 30, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => temisAIUsage.begin(
    requireAuthUid(request),
    request.data?.surface,
    request.data?.requestId,
  ),
);

export const cancelTemisAIUsage = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 30, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => temisAIUsage.cancel(
    requireAuthUid(request),
    request.data?.requestId,
  ),
);

export const completeTemisAIUsage = onCall(
  { ...ACCESS_RUNTIME, region: REGION, timeoutSeconds: 30, maxInstances: 10, secrets: ACCESS_SECRETS },
  async (request) => temisAIUsage.complete(
    requireAuthUid(request),
    request.data?.requestId,
  ),
);

const writeGuildPostIndex = guildAIIndex.createGuildIndexWriter({
  db, FieldValue, requestEmbeddings, embeddingModel: EMBEDDING_MODEL,
});

export const indexGuildPostForAISearch = onDocumentWritten(
  {
    document: "guildPosts/{postId}",
    retry: true,
    region: REGION,
    timeoutSeconds: 60,
    maxInstances: 3,
    serviceAccount: EMBEDDING_RUNTIME_SERVICE_ACCOUNT,
    secrets: [openAiApiKey],
  },
  async (event) => {
    const postId = event.params.postId;
    try {
      await writeGuildPostIndex(postId);
    } catch (error) {
      throw mapOpenAIError(error, "Guild AI indexing");
    }
  },
);

export const searchGuildPostsWithAI = onCall(
  {
    region: REGION,
    timeoutSeconds: 60,
    maxInstances: 3,
    serviceAccount: EMBEDDING_RUNTIME_SERVICE_ACCOUNT,
    secrets: [
      openAiApiKey,
      revenueCatProjectId,
      revenueCatV2SecretApiKey,
      revenueCatCloudSyncEntitlementId,
    ],
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in is required for Guild AI search.");
    const question = readGuildQuestion(request.data);
    if (!question) throw invalidArgument("question must contain 1 to 1000 characters.");
    const requestId = request.data?.requestId;
    await temisAIUsage.begin(uid, "commons", requestId);
    let claimed = false;
    try {
      await temisAIUsage.claim(uid, "commons", requestId);
      claimed = true;
      const [queryEmbedding] = await requestEmbeddings([question]);
      const result = await guildAIRetrieval.retrieveGuildAnswer({
        db, FieldValue, HttpsError, uid, question, queryEmbedding, hasBlockedConnection,
      });
      if (result.evidence.length === 0) {
        const usage = await temisAIUsage.complete(uid, requestId);
        return { answerText: "関連する公開投稿が見つかりませんでした。", citedPostIds: [], evidencePosts: [], usage };
      }
      await result.revalidate();
      const evidence = result.evidence.map((item, index) => ({
        key: `G${index + 1}`,
        text: item.snippetText,
        ...(item.linkPath.every((token) => token.length <= 200) ? { linkPath: item.linkPath } : {}),
      }));
      const generated = await groundedAnswerCore.generateGroundedAnswer({
        apiKey: openAiApiKey.value(),
        data: { question, evidence },
      });
      await result.revalidate();
      const postIdByKey = new Map(evidence.map((item, index) => [item.key, result.posts[index].id]));
      const usage = await temisAIUsage.complete(uid, requestId);
      return {
        answerText: generated.answerText,
        citedPostIds: generated.citedEvidenceKeys.map((key) => postIdByKey.get(key)).filter(Boolean),
        evidencePosts: result.posts,
        usage,
      };
    } catch (error) {
      if (claimed) await temisAIUsage.refund(uid, requestId);
      // No post bodies, questions, or upstream responses in logs.
      logger.error("Temis AI Guild search failed", { code: error?.code ?? null, status: error?.status ?? null });
      if (error instanceof HttpsError) throw error;
      if (error?.code === 9) throw new HttpsError("failed-precondition", "Temis AI search index is not ready.");
      const mapped = mapOpenAIError(error, "Temis AI Guild search");
      if (mapped.code === "failed-precondition") throw new HttpsError("unavailable", "Temis AI search failed. Please retry.");
      throw mapped;
    }
  },
);

export const backfillGuildPostAIIndex = onCall(
  {
    region: REGION,
    timeoutSeconds: 540,
    maxInstances: 1,
    serviceAccount: EMBEDDING_RUNTIME_SERVICE_ACCOUNT,
    secrets: [openAiApiKey],
  },
  async (request) => {
    if (!request.auth?.token?.admin) {
      throw new HttpsError("permission-denied", "Administrator access is required.");
    }
    const limit = Math.min(20, Math.max(1, Math.floor(Number(request.data?.limit) || 10)));
    const cursor = typeof request.data?.cursor === "string" ? request.data.cursor : null;
    let query = db.collection("guildPosts").orderBy(FieldPath.documentId()).limit(limit);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    let indexedCount = 0;
    const failedPostIds = [];
    for (const document of snapshot.docs) {
      try {
        if (await writeGuildPostIndex(document.id)) indexedCount += 1;
      } catch {
        failedPostIds.push(document.id);
      }
    }
    return {
      processedCount: snapshot.size,
      failedPostIds,
      indexedCount,
      nextCursor: snapshot.size === limit ? snapshot.docs[snapshot.docs.length - 1].id : null,
    };
  },
);

// Connection-only direct messages; independent of Cloud Sync entitlements.
export const { sendDirectMessage, markDirectMessagesRead, setDirectMessageDevice, notifyDirectMessage, retryDirectMessageNotifications } = directMessages;

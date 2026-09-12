const { createHash } = require("node:crypto");

const { getApp, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { runAccountDeletionStages, safeFailureCode, validateAppleDeletionConfig, validateRevenueCatProjectId, externalDeletionFailure } = require("./accountDeletionCore.cjs");

initializeApp();

const APPLE_TEAM_ID = defineSecret("APPLE_TEAM_ID");
const APPLE_KEY_ID = defineSecret("APPLE_KEY_ID");
const APPLE_PRIVATE_KEY = defineSecret("APPLE_PRIVATE_KEY");
const REVENUECAT_PROJECT_ID = defineSecret("REVENUECAT_PROJECT_ID");
const REVENUECAT_V2_SECRET_API_KEY = defineSecret(
  "REVENUECAT_V2_SECRET_API_KEY",
);
const CRASHLYTICS_IOS_APP_ID = defineSecret("CRASHLYTICS_IOS_APP_ID");
const SYNC_LOG_SALT = defineSecret("SYNC_LOG_SALT");

const APPLE_CLIENT_ID = "com.anonymous.WeMemo";
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = new URL("/auth/keys", APPLE_ISSUER);
const DEFAULT_SYNC_LOG_SALT = "wememo-sync-observability-v1";

const secretValue = (secret) => secret.value().trim();

const createAppleClientSecret = async () => {
  validateAppleDeletionConfig({ teamId: secretValue(APPLE_TEAM_ID), keyId: secretValue(APPLE_KEY_ID) });
  const { SignJWT, importPKCS8 } = await import("jose");
  const privateKey = secretValue(APPLE_PRIVATE_KEY).replace(/\\n/g, "\n");
  const key = await importPKCS8(privateKey, "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: secretValue(APPLE_KEY_ID) })
    .setIssuer(secretValue(APPLE_TEAM_ID))
    .setSubject(APPLE_CLIENT_ID)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + 5 * 60)
    .sign(key);
};

const getAppleTokens = async (authorizationCode) => {
  const body = new URLSearchParams({
    client_id: APPLE_CLIENT_ID,
    client_secret: await createAppleClientSecret(),
    code: authorizationCode,
    grant_type: "authorization_code",
  });
  const response = await fetch(`${APPLE_ISSUER}/auth/token`, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.refresh_token || !payload?.id_token) {
    throw new HttpsError(
      "failed-precondition",
      "Apple authorization could not be verified. Try account deletion again.",
      { stage: "apple_authorization", reason: payload?.error === "invalid_client" ? "configuration" : "reauthentication", completedStages: [] },
    );
  }
  return payload;
};

const verifyAppleIdentityToken = async (identityToken, expectedSubject) => {
  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  const jwks = createRemoteJWKSet(APPLE_JWKS_URL);
  const { payload } = await jwtVerify(identityToken, jwks, {
    issuer: APPLE_ISSUER,
    audience: APPLE_CLIENT_ID,
  });
  if (payload.sub !== expectedSubject) {
    throw new HttpsError(
      "permission-denied",
      "The Apple authorization does not belong to this account.",
      { stage: "apple_authorization", reason: "account_mismatch", completedStages: [] },
    );
  }
};

const revokeAppleAuthorization = async ({ authorizationCode, expectedSubject }) => {
  const tokens = await getAppleTokens(authorizationCode);
  await verifyAppleIdentityToken(tokens.id_token, expectedSubject);

  const body = new URLSearchParams({
    client_id: APPLE_CLIENT_ID,
    client_secret: await createAppleClientSecret(),
    token: tokens.refresh_token,
    token_type_hint: "refresh_token",
  });
  const response = await fetch(`${APPLE_ISSUER}/auth/revoke`, {
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new HttpsError(
      "internal",
      "Apple authorization could not be revoked. Try account deletion again.",
      { stage: "apple_revocation", reason: "revocation", completedStages: [] },
    );
  }
};

const deleteRevenueCatCustomer = async (uid) => {
  const projectId = secretValue(REVENUECAT_PROJECT_ID);
  validateRevenueCatProjectId(projectId);
  const apiKey = secretValue(REVENUECAT_V2_SECRET_API_KEY);
  const response = await fetch(
    `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(uid)}`,
    {
      method: "DELETE",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  );
  // A missing RevenueCat customer is already deleted from the service.
  if (!response.ok && response.status !== 404) {
    throw await externalDeletionFailure(response);
  }
};

const crashlyticsUserId = (uid) => {
  const salt = secretValue(SYNC_LOG_SALT) || DEFAULT_SYNC_LOG_SALT;
  return createHash("sha256").update(`${salt}\u0000${uid}`).digest("hex");
};

const deleteCrashlyticsReports = async (uid) => {
  const appId = secretValue(CRASHLYTICS_IOS_APP_ID);
  const projectId = getApp().options.projectId;
  if (!projectId || !appId) {
    throw new Error("Crashlytics account-deletion configuration is missing.");
  }
  const accessToken = await getApp().options.credential.getAccessToken();
  const response = await fetch(
    `https://firebasecrashlytics.googleapis.com/v1alpha/projects/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(appId)}/users/${crashlyticsUserId(uid)}/crashReports`,
    {
      method: "DELETE",
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${accessToken.access_token}` },
    },
  );
  if (!response.ok && response.status !== 404) {
    throw await externalDeletionFailure(response);
  }
};

const deleteRedemptionRecords = async (uid) => {
  const firestore = getFirestore();
  const snapshot = await firestore
    .collectionGroup("redemptions")
    .where("userId", "==", uid)
    .get();
  const writer = firestore.bulkWriter();
  try {
    // Individual writes remain buffered until the batch fills or close/flush
    // sends it. Start close before awaiting them; awaiting first deadlocks a
    // partial batch. Observe each result because close alone hides failures.
    const deletions = snapshot.docs.map((document) => writer.delete(document.ref));
    await Promise.all([...deletions, writer.close()]);
  } finally {
    await writer.close();
  }
};

const deleteCoreAccountData = async (uid) => {
  const firestore = getFirestore();
  return runAccountDeletionStages([
    // Fail the indexed query before deleting other data. Every step is retryable.
    ["invitations", () => deleteRedemptionRecords(uid)],
    ["profile", async () => {
      const usernames = await firestore.collection("usernames").where("userId", "==", uid).get();
      for (const document of usernames.docs) await document.ref.delete();
      await firestore.doc(`profiles/${uid}`).delete();
    }],
    ["cloud_data", () => firestore.recursiveDelete(firestore.doc(`users/${uid}`))],
    ["subscription_access", () => firestore.doc(`subscriptionAccess/${uid}`).delete()],
    ["firebase_auth", async () => {
      try { await getAuth().deleteUser(uid); } catch (error) {
        if (error.code !== "auth/user-not-found") throw error;
      }
    }],
  ]);
};

const externalCleanup = async (name, operation) => {
  let timer;
  try {
    await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("External cleanup timeout"), { name: "TimeoutError" })), 12000);
      }),
    ]);
    return { name, completed: true };
  } catch (error) {
    logger.error("Account deletion external cleanup failed", {
      service: name,
      reason: safeFailureCode(error),
    });
    return { name, completed: false };
  } finally {
    clearTimeout(timer);
  }
};

exports.deleteAccount = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 120,
    memory: "256MiB",
    secrets: [
      APPLE_TEAM_ID,
      APPLE_KEY_ID,
      APPLE_PRIVATE_KEY,
      REVENUECAT_PROJECT_ID,
      REVENUECAT_V2_SECRET_API_KEY,
      CRASHLYTICS_IOS_APP_ID,
      SYNC_LOG_SALT,
    ],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Sign in before deleting an account.");
    }

    const uid = request.auth.uid;
    // v1 deletion cannot decide ownership or retention for v2 shared content.
    // Refuse before Apple revocation or any destructive write.
    const sharedReferences = [
      ["projects", "ownerUserId", "=="],
      ["projectMemberships", "userId", "=="],
      ["projectInvitations", "inviterUserId", "=="],
      ["projectInvitations", "inviteeUserId", "=="],
      ["projectTasks", "ownerUserId", "=="],
      ["projectTasks", "creatorUserId", "=="],
      ["projectTasks", "assigneeUserId", "=="],
      ["projectNotes", "ownerUserId", "=="],
      ["guildPosts", "authorUserId", "=="],
      ["guildPosts", "moderation.hiddenByUserId", "=="],
      ["guildReports", "reporterUserId", "=="],
      ["guildReports", "reportedUserId", "=="],
      ["projectJoinRequests", "applicantUserId", "=="],
      ["connections", "userIds", "array-contains"],
    ];
    for (const [collection, field, operator] of sharedReferences) {
      const snapshot = await getFirestore().collection(collection)
        .where(field, operator, uid).limit(1).get();
      if (!snapshot.empty) {
        throw new HttpsError("failed-precondition", "Shared data requires resolution before account deletion.", {
          stage: "shared_data", reason: "shared_data", completedStages: [],
        });
      }
    }
    // Provider linkage, not the last sign-in method, determines Apple revocation.
    let authUser;
    try { authUser = await getAuth().getUser(uid); } catch (error) {
      if (error.code !== "auth/user-not-found") throw new HttpsError("unavailable", "Could not verify deletion state.");
    }
    const appleSubject = authUser?.providerData.find((item) => item.providerId === "apple.com")?.uid;
    const authorizationCode =
      typeof request.data?.appleAuthorizationCode === "string"
        ? request.data.appleAuthorizationCode
        : null;

    if (authorizationCode && authUser && !appleSubject) {
      throw new HttpsError(
        "permission-denied",
        "Apple authorization can only be used for an Apple-signed-in account.",
      );
    }

    if (appleSubject && !authorizationCode) {
      throw new HttpsError("failed-precondition", "Apple reauthentication is required.", {
        stage: "apple_authorization", reason: "reauthentication", completedStages: [],
      });
    }
    // Cancelling Apple reauthentication never proceeds with destructive work.
    let appleAuthorizationRevoked = false;
    if (authorizationCode && appleSubject) {
      try {
        await revokeAppleAuthorization({ authorizationCode, expectedSubject: appleSubject });
      } catch (error) {
        const details = error instanceof HttpsError && error.details ? error.details : {
          stage: "apple_authorization", reason: safeFailureCode(error), completedStages: [],
        };
        logger.warn("Account deletion stopped", details);
        throw new HttpsError("failed-precondition", "Apple authorization could not be completed.", details);
      }
      appleAuthorizationRevoked = true;
    }

    let completedStages;
    try {
      completedStages = await deleteCoreAccountData(uid);
    } catch (error) {
      const details = {
        stage: error.stage ?? "cloud_data",
        completedStages: error.completedStages ?? [],
        reason: safeFailureCode(error.cause),
      };
      logger.error("Account deletion core failed", details);
      throw new HttpsError("failed-precondition", "Account deletion is incomplete. Retry deletion.", details);
    }
    // External outages cannot turn successful Firebase deletion into a failure.
    const cleanup = await Promise.all([
      externalCleanup("revenuecat", () => deleteRevenueCatCustomer(uid)),
      externalCleanup("crashlytics", () => deleteCrashlyticsReports(uid)),
    ]);

    return {
      deleted: true,
      completedStages,
      appleAuthorizationRevoked,
      externalCleanupPending: cleanup
        .filter((item) => !item.completed)
        .map((item) => item.name),
    };
  },
);

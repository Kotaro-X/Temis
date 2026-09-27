import process from "node:process";
import { createRequire } from "node:module";
import { initializeApp } from "firebase-admin/app";

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { initializeAdminApp, takeValue } from "./firebase-admin-runtime.ts";

type Args = {
  apply: boolean;
  projectId: string | null;
  serviceAccountPath: string | null;
  firebaseCli: boolean;
};

const USAGE = `
Usage:
  npm run firebase:prepare-freemium -- --project-id <projectId> [--firebase-cli] [--apply]

--firebase-cli uses the signed-in CLI account and existing Secret Manager values
in memory only. Without it, use application default credentials or --service-account.

Dry-run is the default. --apply requires these environment variables:
  REVENUECAT_PROJECT_ID
  REVENUECAT_V2_SECRET_API_KEY
  REVENUECAT_CLOUD_SYNC_ENTITLEMENT_ID
`.trim();

const parseArgs = (argv: string[]): Args => {
  const args: Args = { apply: false, projectId: null, serviceAccountPath: null, firebaseCli: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") args.apply = true;
    else if (token === "--firebase-cli") args.firebaseCli = true;
    else if (token === "--project-id") {
      args.projectId = takeValue(argv, index, token);
      index += 1;
    } else if (token === "--service-account") {
      args.serviceAccountPath = takeValue(argv, index, token);
      index += 1;
    } else if (token === "--help" || token === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.projectId) throw new Error("Specify --project-id.");
  return args;
};

const toMillis = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
};

const activeFreeSource = (grant: FirebaseFirestore.DocumentData | null, now: number) => {
  const expiresAt = toMillis(grant?.expiresAt);
  if (
    grant?.active === true
    && (grant.grantType === "staff_free" || grant.grantType === "invite_free")
    && (expiresAt === null || expiresAt > now)
  ) return grant.grantType as "staff_free" | "invite_free";
  return null;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const require = createRequire(import.meta.url);
  let cliToken: (() => Promise<string>) | null = null;
  if (args.firebaseCli) {
    const { requireAuth } = require("firebase-tools/lib/requireAuth");
    const cliAuth = require("firebase-tools/lib/auth");
    await requireAuth({ project: args.projectId, ...cliAuth.getGlobalDefaultAccount() });
    cliToken = require("firebase-tools/lib/apiv2").getAccessToken;
  }
  const app = cliToken ? initializeApp({ projectId: args.projectId!, credential: {
    getAccessToken: async () => ({ access_token: await cliToken!(), expires_in: 3600 }),
  } }) : initializeAdminApp(args);
  let db: FirebaseFirestore.Firestore;
  if (cliToken) {
    const { OAuth2Client } = require("google-auth-library");
    const { Firestore } = require("@google-cloud/firestore");
    const authClient = new OAuth2Client();
    authClient.setCredentials({ access_token: await cliToken(), expiry_date: Date.now() + 50 * 60_000 });
    db = new Firestore({ projectId: args.projectId, authClient });
  } else db = getFirestore(app);
  const auth = getAuth(app);
  const now = Date.now();
  const leaseUntil = now + 24 * 60 * 60 * 1000;
  const revenueCat = {
    projectId: process.env.REVENUECAT_PROJECT_ID?.trim() ?? "",
    apiKey: process.env.REVENUECAT_V2_SECRET_API_KEY?.trim() ?? "",
    entitlementId: process.env.REVENUECAT_CLOUD_SYNC_ENTITLEMENT_ID?.trim() ?? "",
  };
  if (cliToken) {
    for (const [field, name] of Object.entries({ projectId: "REVENUECAT_PROJECT_ID", apiKey: "REVENUECAT_V2_SECRET_API_KEY", entitlementId: "REVENUECAT_CLOUD_SYNC_ENTITLEMENT_ID" })) {
      const response = await fetch(`https://secretmanager.googleapis.com/v1/projects/${args.projectId}/secrets/${name}/versions/latest:access`, {
        headers: { Authorization: `Bearer ${await cliToken()}` }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Secret access failed: HTTP ${response.status}.`);
      const secret = await response.json() as { payload: { data: string } };
      revenueCat[field as keyof typeof revenueCat] = Buffer.from(secret.payload.data, "base64").toString("utf8").trim();
    }
  }
  if (args.apply && Object.values(revenueCat).some((value) => !value)) {
    throw new Error("--apply requires all three RevenueCat environment variables.");
  }

  const [membershipsSnapshot, notesSnapshot, tasksSnapshot] = await Promise.all([
    db.collection("projectMemberships").get(),
    db.collection("projectNotes").get(),
    db.collection("projectTasks").get(),
  ]);
  const memberships = new Map<string, { projectId: string; role: string }[]>();
  for (const document of membershipsSnapshot.docs) {
    const value = document.data();
    const current = memberships.get(value.userId) ?? [];
    current.push({ projectId: value.projectId, role: value.role });
    memberships.set(value.userId, current);
  }
  const compatibility = {
    notesMissingOwner: notesSnapshot.docs.filter((document) => !("ownerUserId" in document.data())).length,
    notesMissingSource: notesSnapshot.docs.filter((document) => !("sourceNoteId" in document.data())).length,
    tasksMissingOwner: tasksSnapshot.docs.filter((document) => !("ownerUserId" in document.data())).length,
    tasksMissingCreator: tasksSnapshot.docs.filter((document) => !("creatorUserId" in document.data())).length,
  };
  if (args.apply && Object.values(compatibility).some((count) => count > 0)) throw new Error("Resolve incompatible shared documents before applying the backfill.");

  let pageToken: string | undefined;
  let userCount = 0;
  let plusCount = 0;
  let freeCount = 0;
  let overflowCount = 0;
  let revenueCatUnknownCount = 0;
  let accessWrites = 0;
  let stateWrites = 0;
  do {
    const page = await auth.listUsers(500, pageToken);
    for (const user of page.users) {
      userCount += 1;
      const grantSnapshot = await db.doc(`subscriptionAccess/${user.uid}`).get();
      const existingAccess = (await db.doc(`temisAccessStates/${user.uid}`).get()).data();
      const preservedAccess = existingAccess?.userId === user.uid && existingAccess.verifiedUntil > Date.now() ? existingAccess : null;
      const grantSource = activeFreeSource(grantSnapshot.exists ? grantSnapshot.data() ?? null : null, now);
      let tier: "free" | "plus" = grantSource ? "plus" : "free";
      let source: "revenuecat" | "staff_free" | "invite_free" | "none" = grantSource ?? "none";
      if (preservedAccess) {
        tier = preservedAccess.tier;
        source = preservedAccess.source;
      } else if (!grantSource && revenueCat.projectId) {
        const response = await fetch(
          `https://api.revenuecat.com/v2/projects/${encodeURIComponent(revenueCat.projectId)}/customers/${encodeURIComponent(user.uid)}/active_entitlements`,
          { headers: { Authorization: `Bearer ${revenueCat.apiKey}` }, signal: AbortSignal.timeout(15_000) },
        );
        if (response.status !== 404 && !response.ok) throw new Error(`RevenueCat verification failed with HTTP ${response.status}.`);
        const body = response.ok ? await response.json() as { items?: { entitlement_id?: string }[] } : null;
        if (response.ok && !Array.isArray(body?.items)) throw new Error("Invalid RevenueCat response; no downgrade applied.");
        if (body?.items?.some((item) => item.entitlement_id === revenueCat.entitlementId)) {
          tier = "plus";
          source = "revenuecat";
        }
      } else if (!grantSource) {
        revenueCatUnknownCount += 1;
      }
      const userMemberships = memberships.get(user.uid) ?? [];
      const state = tier === "plus" || userMemberships.length <= 1
        ? {
            userId: user.uid,
            status: "ready",
            membershipCount: userMemberships.length,
            freeProjectId: tier === "free" && userMemberships.length === 1 ? userMemberships[0].projectId : null,
            pendingFreeProjectId: null,
            updatedAt: now,
          }
        : {
            userId: user.uid,
            status: "selection_required",
            membershipCount: userMemberships.length,
            freeProjectId: null,
            pendingFreeProjectId: null,
            updatedAt: now,
          };
      if (tier === "plus") plusCount += 1;
      else freeCount += 1;
      if (state.status === "selection_required") overflowCount += 1;
      if (args.apply) {
        const result = await db.runTransaction(async (transaction) => {
          const accessRef = db.doc(`temisAccessStates/${user.uid}`);
          const stateRef = db.doc(`projectAccessStates/${user.uid}`);
          const [currentAccess, currentState, currentMemberships] = await Promise.all([
            transaction.get(accessRef), transaction.get(stateRef),
            transaction.get(db.collection("projectMemberships").where("userId", "==", user.uid)),
          ]);
          const { planBackfillWrites } = require("./freemium-backfill-core.cjs");
          const writes = planBackfillWrites({ uid: user.uid,
            verifiedAccess: preservedAccess ?? { userId: user.uid, tier, source, verifiedAt: now, verifiedUntil: grantSource ? Math.min(leaseUntil, toMillis(grantSnapshot.data()?.expiresAt) ?? leaseUntil) : leaseUntil, updatedAt: now },
            savedAccess: currentAccess.data(), savedStateExists: currentState.exists,
            memberships: currentMemberships.docs.map((doc) => doc.data()), now: Date.now(),
          });
          if (writes.access) transaction.set(accessRef, writes.access);
          if (writes.state) transaction.set(stateRef, writes.state);
          return { access: !!writes.access, state: !!writes.state };
        });
        if (result.access) accessWrites++;
        if (result.state) stateWrites++;
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "dry-run",
    userCount,
    plusCount,
    freeCount,
    overflowCount,
    revenueCatUnknownCount,
    accessWrites,
    stateWrites,
    membershipDocumentCount: membershipsSnapshot.size,
    compatibility,
  }, null, 2));
};

main().catch((error) => {
  console.error("Freemium rollout preparation failed.", { code: error?.code ?? null, category: error?.name ?? "Error" });
  process.exitCode = 1;
});

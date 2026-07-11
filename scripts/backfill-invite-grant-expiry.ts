import process from "node:process";

import { getFirestore } from "firebase-admin/firestore";

import {
  initializeAdminApp,
  parseOptionalNumber,
  takeValue,
} from "./firebase-admin-runtime.ts";

type GrantType = "invite_free" | "invite_discount";

type Args = {
  code: string | null;
  expiresAt: number | null;
  grantType: GrantType | null;
  serviceAccountPath: string | null;
  projectId: string | null;
};

const USAGE = `
Usage:
  npm run firebase:backfill-invite-grant-expiry -- --code <CODE> --expires-at <unix-ms>

Options:
  --code <code>               Invite code identifier
  --expires-at <unix-ms>      Expiry timestamp in milliseconds
  --grant-type <type>         Optional filter: invite_free | invite_discount
  --service-account <path>    Optional service account JSON path
  --project-id <projectId>    Optional Firebase project id override
`.trim();

const isGrantType = (value: unknown): value is GrantType =>
  value === "invite_free" || value === "invite_discount";

const parseArgs = (argv: string[]): Args => {
  const next: Args = {
    code: null,
    expiresAt: null,
    grantType: null,
    serviceAccountPath: null,
    projectId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--code":
        next.code = takeValue(argv, index, token).toUpperCase();
        index += 1;
        break;
      case "--expires-at":
        next.expiresAt = parseOptionalNumber(takeValue(argv, index, token));
        index += 1;
        break;
      case "--grant-type": {
        const value = takeValue(argv, index, token);
        if (!isGrantType(value)) {
          throw new Error(`Invalid grant type: ${value}`);
        }
        next.grantType = value;
        index += 1;
        break;
      }
      case "--service-account":
        next.serviceAccountPath = takeValue(argv, index, token);
        index += 1;
        break;
      case "--project-id":
        next.projectId = takeValue(argv, index, token);
        index += 1;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!next.code) {
    throw new Error("Specify --code.");
  }
  if (next.expiresAt === null) {
    throw new Error("Specify --expires-at.");
  }

  return next;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const app = initializeAdminApp(args);
  const firestore = getFirestore(app);
  const code = args.code as string;
  const expiresAt = args.expiresAt as number;

  let query = firestore.collection("subscriptionAccess").where("inviteCode", "==", code);
  if (args.grantType) {
    query = query.where("grantType", "==", args.grantType);
  }

  const snapshot = await query.get();
  const now = Date.now();
  let updatedCount = 0;
  const updatedUserIds: string[] = [];

  let batch = firestore.batch();
  let ops = 0;
  const commitBatch = async () => {
    if (ops === 0) {
      return;
    }
    await batch.commit();
    batch = firestore.batch();
    ops = 0;
  };

  for (const grantDoc of snapshot.docs) {
    const currentExpiresAt = grantDoc.get("expiresAt");
    if (currentExpiresAt === expiresAt) {
      continue;
    }

    batch.set(
      grantDoc.ref,
      {
        expiresAt,
        updatedAt: now,
      },
      { merge: true },
    );
    updatedCount += 1;
    updatedUserIds.push(grantDoc.id);
    ops += 1;

    if (ops >= 400) {
      await commitBatch();
    }
  }

  await commitBatch();

  console.log(
    JSON.stringify(
      {
        code,
        grantType: args.grantType,
        expiresAt,
        matchedCount: snapshot.size,
        updatedCount,
        unchangedCount: snapshot.size - updatedCount,
        updatedUserIds,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error(USAGE);
  process.exit(1);
});

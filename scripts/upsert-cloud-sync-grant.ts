import process from "node:process";

import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import {
  initializeAdminApp,
  parseOptionalNumber,
  takeValue,
} from "./firebase-admin-runtime.ts";

type GrantType = "staff_free" | "invite_free" | "invite_discount";

type Args = {
  uid: string | null;
  email: string | null;
  grantType: GrantType;
  inviteCode: string | null;
  offeringId: string | null;
  packageId: string | null;
  expiresAt: number | null;
  grantedBy: string | null;
  note: string | null;
  serviceAccountPath: string | null;
  projectId: string | null;
};

const USAGE = `
Usage:
  npm run firebase:grant-cloud-sync -- --uid <FIREBASE_UID>
  npm run firebase:grant-cloud-sync -- --email <EMAIL>

Options:
  --uid <uid>                 Target Firebase Auth user id
  --email <email>             Target Firebase Auth email
  --grant-type <type>         staff_free | invite_free | invite_discount
  --invite-code <code>        Optional invite code reference
  --offering-id <id>          Optional RevenueCat offering override
  --package-id <id>           Optional RevenueCat package override
  --expires-at <unix-ms>      Optional expiry timestamp in milliseconds
  --granted-by <uid>          Optional admin/staff uid
  --note <text>               Optional note
  --service-account <path>    Optional service account JSON path
  --project-id <projectId>    Optional Firebase project id override
`.trim();

const normalizeOptionalString = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isGrantType = (value: string): value is GrantType =>
  value === "staff_free" ||
  value === "invite_free" ||
  value === "invite_discount";

const parseArgs = (argv: string[]): Args => {
  const next: Args = {
    uid: null,
    email: null,
    grantType: "staff_free",
    inviteCode: null,
    offeringId: null,
    packageId: null,
    expiresAt: null,
    grantedBy: null,
    note: null,
    serviceAccountPath: null,
    projectId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--uid":
        next.uid = takeValue(argv, index, token);
        index += 1;
        break;
      case "--email":
        next.email = takeValue(argv, index, token);
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
      case "--invite-code":
        next.inviteCode = takeValue(argv, index, token).toUpperCase();
        index += 1;
        break;
      case "--offering-id":
        next.offeringId = takeValue(argv, index, token);
        index += 1;
        break;
      case "--package-id":
        next.packageId = takeValue(argv, index, token);
        index += 1;
        break;
      case "--expires-at":
        next.expiresAt = parseOptionalNumber(takeValue(argv, index, token));
        index += 1;
        break;
      case "--granted-by":
        next.grantedBy = takeValue(argv, index, token);
        index += 1;
        break;
      case "--note":
        next.note = takeValue(argv, index, token);
        index += 1;
        break;
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

  if ((next.uid ? 1 : 0) + (next.email ? 1 : 0) !== 1) {
    throw new Error("Specify exactly one of --uid or --email.");
  }

  if (next.grantType === "invite_discount" && !next.inviteCode) {
    throw new Error("invite_discount requires --invite-code.");
  }

  return next;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const app = initializeAdminApp(args);
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  const user = args.uid
    ? await auth.getUser(args.uid)
    : await auth.getUserByEmail(args.email as string);

  const now = Date.now();
  const payload = {
    userId: user.uid,
    active: true,
    grantType: args.grantType,
    inviteCode: normalizeOptionalString(args.inviteCode),
    offeringId: normalizeOptionalString(args.offeringId),
    packageId: normalizeOptionalString(args.packageId),
    expiresAt: args.expiresAt,
    grantedBy: normalizeOptionalString(args.grantedBy),
    note: normalizeOptionalString(args.note),
    redeemedAt:
      args.grantType === "staff_free" ? null : now,
    updatedAt: now,
  };

  await firestore.collection("subscriptionAccess").doc(user.uid).set(payload, {
    merge: true,
  });

  console.log(JSON.stringify(payload, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error(USAGE);
  process.exit(1);
});

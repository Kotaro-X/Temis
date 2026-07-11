import process from "node:process";

import { getFirestore } from "firebase-admin/firestore";

import {
  initializeAdminApp,
  parseOptionalNumber,
  takeValue,
} from "./firebase-admin-runtime.ts";

type InviteGrantType = "invite_free" | "invite_discount";

type Args = {
  code: string | null;
  grantType: InviteGrantType;
  grantTypeSpecified: boolean;
  offeringId: string | null;
  offeringIdSpecified: boolean;
  packageId: string | null;
  packageIdSpecified: boolean;
  expiresAt: number | null;
  expiresAtSpecified: boolean;
  maxRedemptions: number | null;
  maxRedemptionsSpecified: boolean;
  createdBy: string | null;
  createdBySpecified: boolean;
  note: string | null;
  noteSpecified: boolean;
  serviceAccountPath: string | null;
  projectId: string | null;
};

type ExistingInviteCodeRecord = {
  active: boolean;
  grantType: InviteGrantType;
  offeringId: string | null;
  packageId: string | null;
  expiresAt: number | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  createdBy: string | null;
  note: string | null;
};

const USAGE = `
Usage:
  npm run firebase:create-invite-code -- --code <CODE> --grant-type invite_free
  npm run firebase:create-invite-code -- --code <CODE> --grant-type invite_discount --offering-id <REVENUECAT_OFFERING>

Options:
  --code <code>               Invite code identifier
  --grant-type <type>         invite_free | invite_discount
  --offering-id <id>          RevenueCat offering override
  --package-id <id>           RevenueCat package override
  --expires-at <unix-ms>      Optional expiry timestamp in milliseconds
  --max-redemptions <count>   Optional redemption cap
  --created-by <uid>          Optional creator uid
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

const normalizeOptionalNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const normalizeBoolean = (value: unknown): boolean => value === true;

const isInviteGrantType = (value: unknown): value is InviteGrantType =>
  value === "invite_free" || value === "invite_discount";

const parseArgs = (argv: string[]): Args => {
  const next: Args = {
    code: null,
    grantType: "invite_free",
    grantTypeSpecified: false,
    offeringId: null,
    offeringIdSpecified: false,
    packageId: null,
    packageIdSpecified: false,
    expiresAt: null,
    expiresAtSpecified: false,
    maxRedemptions: null,
    maxRedemptionsSpecified: false,
    createdBy: null,
    createdBySpecified: false,
    note: null,
    noteSpecified: false,
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
      case "--grant-type": {
        const value = takeValue(argv, index, token);
        if (!isInviteGrantType(value)) {
          throw new Error(`Invalid grant type: ${value}`);
        }
        next.grantType = value;
        next.grantTypeSpecified = true;
        index += 1;
        break;
      }
      case "--offering-id":
        next.offeringId = takeValue(argv, index, token);
        next.offeringIdSpecified = true;
        index += 1;
        break;
      case "--package-id":
        next.packageId = takeValue(argv, index, token);
        next.packageIdSpecified = true;
        index += 1;
        break;
      case "--expires-at":
        next.expiresAt = parseOptionalNumber(takeValue(argv, index, token));
        next.expiresAtSpecified = true;
        index += 1;
        break;
      case "--max-redemptions":
        next.maxRedemptions = parseOptionalNumber(takeValue(argv, index, token));
        next.maxRedemptionsSpecified = true;
        index += 1;
        break;
      case "--created-by":
        next.createdBy = takeValue(argv, index, token);
        next.createdBySpecified = true;
        index += 1;
        break;
      case "--note":
        next.note = takeValue(argv, index, token);
        next.noteSpecified = true;
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

  if (!next.code) {
    throw new Error("Specify --code.");
  }

  return next;
};

const parseExistingInviteCodeRecord = (
  raw: unknown,
): ExistingInviteCodeRecord | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!isInviteGrantType(record.grantType)) {
    return null;
  }
  const grantType = record.grantType;
  return {
    active: normalizeBoolean(record.active),
    grantType,
    offeringId: normalizeOptionalString(
      typeof record.offeringId === "string" ? record.offeringId : null,
    ),
    packageId: normalizeOptionalString(
      typeof record.packageId === "string" ? record.packageId : null,
    ),
    expiresAt: normalizeOptionalNumber(record.expiresAt),
    maxRedemptions: normalizeOptionalNumber(record.maxRedemptions),
    redeemedCount:
      typeof record.redeemedCount === "number" && Number.isFinite(record.redeemedCount)
        ? Math.max(0, Math.floor(record.redeemedCount))
        : 0,
    createdBy: normalizeOptionalString(
      typeof record.createdBy === "string" ? record.createdBy : null,
    ),
    note: normalizeOptionalString(typeof record.note === "string" ? record.note : null),
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const app = initializeAdminApp(args);
  const firestore = getFirestore(app);
  const code = args.code as string;
  const inviteRef = firestore.collection("inviteCodes").doc(code);
  const existingSnapshot = await inviteRef.get();
  const existing = existingSnapshot.exists
    ? parseExistingInviteCodeRecord(existingSnapshot.data())
    : null;

  const grantType = args.grantTypeSpecified
    ? args.grantType
    : existing?.grantType ?? "invite_free";
  const offeringId = args.offeringIdSpecified
    ? normalizeOptionalString(args.offeringId)
    : existing?.offeringId ?? null;
  const packageId = args.packageIdSpecified
    ? normalizeOptionalString(args.packageId)
    : existing?.packageId ?? null;
  const expiresAt = args.expiresAtSpecified
    ? args.expiresAt
    : existing?.expiresAt ?? null;
  const maxRedemptions = args.maxRedemptionsSpecified
    ? args.maxRedemptions
    : existing?.maxRedemptions ?? null;
  const createdBy = args.createdBySpecified
    ? normalizeOptionalString(args.createdBy)
    : existing?.createdBy ?? null;
  const note = args.noteSpecified
    ? normalizeOptionalString(args.note)
    : existing?.note ?? null;

  if (grantType === "invite_discount" && !offeringId) {
    throw new Error("invite_discount requires --offering-id on create or an existing offeringId.");
  }

  const now = Date.now();
  const payload = {
    code,
    active: true,
    grantType,
    offeringId,
    packageId,
    expiresAt,
    maxRedemptions,
    redeemedCount: existing?.redeemedCount ?? 0,
    createdBy,
    note,
    updatedAt: now,
  };

  await inviteRef.set(payload, {
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

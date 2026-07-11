import { readFileSync } from "node:fs";

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";

export type FirebaseAdminArgs = {
  serviceAccountPath: string | null;
  projectId: string | null;
};

export const takeValue = (argv: string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
};

export const parseBoolean = (
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
};

export const parseOptionalNumber = (value: string | undefined): number | null => {
  if (!value || value === "null" || value === "none") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number value: ${value}`);
  }
  return parsed;
};

export const initializeAdminApp = (args: FirebaseAdminArgs) => {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  if (args.serviceAccountPath) {
    const serviceAccount = JSON.parse(
      readFileSync(args.serviceAccountPath, "utf8"),
    ) as Record<string, unknown>;
    return initializeApp({
      credential: cert(serviceAccount as any),
      projectId:
        args.projectId ??
        (typeof serviceAccount.project_id === "string"
          ? serviceAccount.project_id
          : undefined),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: args.projectId ?? undefined,
  });
};

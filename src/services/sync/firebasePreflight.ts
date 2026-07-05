import {
  FIREBASE_ENV_KEYS,
  createFirebaseConfigErrorMessage,
  type FirebaseEnvKey,
} from "./firebaseConfig.ts";

type FirebaseEnvSource = Record<string, string | undefined>;

export type FirebasePreflightLayer = {
  label: string;
  env: FirebaseEnvSource;
};

export type FirebasePreflightKeyStatus = {
  key: FirebaseEnvKey;
  value: string;
  present: boolean;
  source: string | null;
};

export type FirebasePreflightResult = {
  resolvedEnv: Record<FirebaseEnvKey, string | undefined>;
  keys: FirebasePreflightKeyStatus[];
  missingKeys: FirebaseEnvKey[];
  errorMessage: string;
  configComplete: boolean;
};

const normalizeValue = (value: string | undefined) => value?.trim() ?? "";

const stripInlineComment = (value: string) => {
  const commentIndex = value.search(/\s#/);
  if (commentIndex === -1) {
    return value;
  }
  return value.slice(0, commentIndex).trimEnd();
};

const decodeDoubleQuotedValue = (value: string) =>
  value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");

export const parseEnvFile = (contents: string): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (
      rawValue.startsWith("\"") &&
      rawValue.endsWith("\"") &&
      rawValue.length >= 2
    ) {
      result[key] = decodeDoubleQuotedValue(rawValue.slice(1, -1));
      continue;
    }
    if (
      rawValue.startsWith("'") &&
      rawValue.endsWith("'") &&
      rawValue.length >= 2
    ) {
      result[key] = rawValue.slice(1, -1);
      continue;
    }

    result[key] = stripInlineComment(rawValue).trim();
  }

  return result;
};

export const resolveFirebasePreflight = (
  layers: FirebasePreflightLayer[],
): FirebasePreflightResult => {
  const resolvedEnv = {} as Record<FirebaseEnvKey, string | undefined>;
  const sourceByKey = {} as Record<FirebaseEnvKey, string | null>;

  for (const key of FIREBASE_ENV_KEYS) {
    resolvedEnv[key] = undefined;
    sourceByKey[key] = null;
  }

  for (const layer of layers) {
    for (const key of FIREBASE_ENV_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(layer.env, key)) {
        continue;
      }
      resolvedEnv[key] = layer.env[key];
      sourceByKey[key] = layer.label;
    }
  }

  const keys = FIREBASE_ENV_KEYS.map((key) => {
    const value = normalizeValue(resolvedEnv[key]);
    return {
      key,
      value,
      present: value.length > 0,
      source: sourceByKey[key],
    };
  });

  const missingKeys = keys
    .filter((entry) => !entry.present)
    .map((entry) => entry.key);

  return {
    resolvedEnv,
    keys,
    missingKeys,
    errorMessage: createFirebaseConfigErrorMessage(resolvedEnv),
    configComplete: missingKeys.length === 0,
  };
};

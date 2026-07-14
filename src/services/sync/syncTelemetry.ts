import { Platform } from "react-native";
import { nanoid } from "nanoid/non-secure";
import { sha256 } from "js-sha256";

import appJson from "../../../app.json";
import { MIGRATIONS } from "../../db/migrations";
import {
  createAnonymousUserId,
  createSyncDiagnosticReporter,
  toCrashlyticsAttributes,
} from "./syncDiagnostics";
import type { SyncRunDiagnosticContext } from "./syncDiagnosticObserver";
import { CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION } from "./syncEnvelopeValidator";

const ANONYMOUS_USER_ID_SALT =
  process.env.EXPO_PUBLIC_SYNC_LOG_SALT?.trim() ||
  "wememo-sync-observability-v1";

declare const require: (id: string) => unknown;

type CrashlyticsModule = typeof import("@react-native-firebase/crashlytics");

export const syncDiagnosticReporter = createSyncDiagnosticReporter({
  writeConsole: (message) => console.info(message),
  sink: async (event, options) => {
    const {
      getCrashlytics,
      log,
      recordError,
      setAttributes,
      setUserId,
    } = require("@react-native-firebase/crashlytics") as CrashlyticsModule;
    const crashlytics = getCrashlytics();
    await Promise.all([
      setUserId(crashlytics, event.anonymousUserId),
      setAttributes(crashlytics, toCrashlyticsAttributes(event)),
    ]);
    log(crashlytics, `[sync] ${event.entity} ${event.phase}`);
    if (options.recordAsError && event.errorCode && event.sanitizedReason) {
      const safeError = new Error(
        `${event.errorCode}: ${event.sanitizedReason}`,
      );
      safeError.name = "SanitizedSyncError";
      recordError(crashlytics, safeError);
    }
  },
});

export const createSyncRunDiagnosticContext = async (
  internalUserId: string,
): Promise<SyncRunDiagnosticContext> => ({
  anonymousUserId: await createAnonymousUserId(
    internalUserId,
    ANONYMOUS_USER_ID_SALT,
    async (value) => sha256(value),
  ),
  syncId: nanoid(),
  appVersion: appJson.expo.version,
  osVersion: `${Platform.OS}-${String(Platform.Version)}`,
  schemaVersion: CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION,
  migrationVersion: MIGRATIONS.at(-1)?.version ?? "unknown",
});

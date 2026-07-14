import type { SyncEntityEnvelope, SyncEntityType } from "../../types";
import {
  logSkippedSyncEnvelope,
  validateSyncEnvelope,
  type SyncEnvelopeValidationFailure,
} from "./syncEnvelopeValidator.ts";

type SyncableEntityType = Exclude<SyncEntityType, "tag">;

export type PulledFirestoreDocument = {
  id: string;
  data: unknown;
};

export type MigratedFirestoreEnvelope<TType extends SyncableEntityType> = {
  documentId: string;
  envelope: SyncEntityEnvelope<TType>;
};

/**
 * Keeps invalid documents out of the sync merge while retaining every valid
 * document. This is intentionally Firestore-independent for regression tests.
 */
export const inspectPulledSyncEnvelopes = <TType extends SyncableEntityType>(
  entityType: TType,
  documents: readonly PulledFirestoreDocument[],
): {
  envelopes: SyncEntityEnvelope<TType>[];
  migrations: MigratedFirestoreEnvelope<TType>[];
  validationFailures: SyncEnvelopeValidationFailure[];
} => {
  const envelopes: SyncEntityEnvelope<TType>[] = [];
  const migrations: MigratedFirestoreEnvelope<TType>[] = [];
  const validationFailures: SyncEnvelopeValidationFailure[] = [];
  for (const document of documents) {
    const result = validateSyncEnvelope(entityType, document.data);
    if (!result.ok) {
      logSkippedSyncEnvelope(entityType, document.id, result);
      validationFailures.push(result);
      continue;
    }
    envelopes.push(result.envelope);
    if (result.migrated) {
      migrations.push({ documentId: document.id, envelope: result.envelope });
    }
  }
  return { envelopes, migrations, validationFailures };
};

export const validatePulledSyncEnvelopes = <TType extends SyncableEntityType>(
  entityType: TType,
  documents: readonly PulledFirestoreDocument[],
): SyncEntityEnvelope<TType>[] =>
  inspectPulledSyncEnvelopes(entityType, documents).envelopes;

export const rewriteMigratedSyncEnvelopes = async <TType extends SyncableEntityType>(
  entityType: TType,
  migrations: readonly MigratedFirestoreEnvelope<TType>[],
  rewrite: (documentId: string, envelope: SyncEntityEnvelope<TType>) => Promise<void>,
): Promise<void> => {
  await Promise.all(
    migrations.map(async ({ documentId, envelope }) => {
      try {
        await rewrite(documentId, envelope);
      } catch {
        console.warn(
          `[sync] failed to rewrite migrated ${entityType} record`,
        );
      }
    }),
  );
};

import type { SyncEntityEnvelope, SyncEntityType } from "../../types";
import {
  logSkippedSyncEnvelope,
  validateSyncEnvelope,
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
} => {
  const envelopes: SyncEntityEnvelope<TType>[] = [];
  const migrations: MigratedFirestoreEnvelope<TType>[] = [];
  for (const document of documents) {
    const result = validateSyncEnvelope(entityType, document.data);
    if (!result.ok) {
      logSkippedSyncEnvelope(entityType, document.id, result);
      continue;
    }
    envelopes.push(result.envelope);
    if (result.migrated) {
      migrations.push({ documentId: document.id, envelope: result.envelope });
    }
  }
  return { envelopes, migrations };
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
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(
          `[sync] failed to rewrite migrated ${entityType} record documentId=${documentId} detail=${detail}`,
        );
      }
    }),
  );
};

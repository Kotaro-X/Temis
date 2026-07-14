import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  startAfter,
  where,
  type QueryConstraint,
} from "firebase/firestore";

import type {
  SyncEntityEnvelope,
  SyncEntityType,
  SyncPullCursor,
} from "../../types";
import { getFirebaseFirestore } from "./firebaseApp";
import { compareSyncVersions, SYNC_PAGE_SIZE } from "./syncCore";
import {
  CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION,
  assertValidSyncEnvelopeForWrite,
} from "./syncEnvelopeValidator";
import {
  inspectPulledSyncEnvelopes,
  rewriteMigratedSyncEnvelopes,
} from "./syncEnvelopePullProcessor";

const COLLECTION_BY_ENTITY: Record<SyncEntityType, string> = {
  tag: "tags",
  todo: "todos",
  task: "tasks",
  memo: "memos",
};

const getEntityCollection = (userId: string, entityType: SyncEntityType) =>
  collection(
    getFirebaseFirestore(),
    "users",
    userId,
    COLLECTION_BY_ENTITY[entityType],
  );

export const pushSyncEnvelope = async <TType extends Exclude<SyncEntityType, "tag">>(
  userId: string,
  envelope: SyncEntityEnvelope<TType>,
): Promise<boolean> => {
  const validatedEnvelope = assertValidSyncEnvelopeForWrite(envelope);
  const firestore = getFirebaseFirestore();
  const documentRef = doc(
    getEntityCollection(userId, validatedEnvelope.entityType),
    validatedEnvelope.entityId,
  );
  return runTransaction(firestore, async (transaction) => {
    const currentSnapshot = await transaction.get(documentRef);
    if (currentSnapshot.exists()) {
      const current = currentSnapshot.data();
      if (
        typeof current.schemaVersion === "number" &&
        current.schemaVersion > CURRENT_SYNC_ENVELOPE_SCHEMA_VERSION
      ) {
        return false;
      }
      if (
        typeof current.updatedAt === "number" &&
        compareSyncVersions(validatedEnvelope, {
          updatedAt: current.updatedAt,
          deletedAt:
            typeof current.deletedAt === "number" ? current.deletedAt : null,
          deviceId: typeof current.deviceId === "string" ? current.deviceId : null,
        }) <= 0
      ) {
        return false;
      }
    }
    // Replace the document so old/unknown fields cannot survive a migration.
    transaction.set(documentRef, validatedEnvelope);
    return true;
  });
};

export const deleteSyncEnvelope = async <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  userId: string,
  entityType: TType,
  entityId: string,
): Promise<void> => {
  await deleteDoc(doc(getEntityCollection(userId, entityType), entityId));
};

export const pullSyncEnvelopes = async <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  userId: string,
  entityType: TType,
): Promise<SyncEntityEnvelope<TType>[]> => {
  const records: SyncEntityEnvelope<TType>[] = [];
  let after: SyncPullCursor | null = null;
  while (true) {
    const page: {
      records: SyncEntityEnvelope<TType>[];
      nextCursor: SyncPullCursor | null;
      hasMore: boolean;
    } = await pullSyncEnvelopePage(userId, entityType, {
      updatedAfter: null,
      after,
      pageSize: SYNC_PAGE_SIZE,
    });
    records.push(...page.records);
    if (!page.hasMore || !page.nextCursor) {
      return records;
    }
    after = page.nextCursor;
  }
};

export const pullSyncEnvelopePage = async <
  TType extends Exclude<SyncEntityType, "tag">,
>(
  userId: string,
  entityType: TType,
  request: {
    updatedAfter: number | null;
    after: SyncPullCursor | null;
    pageSize?: number;
  },
  callbacks: {
    onValidationFailure?: (
      failure: import("./syncEnvelopeValidator").SyncEnvelopeValidationFailure,
    ) => void | Promise<void>;
  } = {},
): Promise<{
  records: SyncEntityEnvelope<TType>[];
  nextCursor: SyncPullCursor | null;
  hasMore: boolean;
}> => {
  const pageSize = request.pageSize ?? SYNC_PAGE_SIZE;
  const constraints: QueryConstraint[] = [];
  if (request.updatedAfter !== null) {
    constraints.push(where("updatedAt", ">", request.updatedAfter));
  }
  constraints.push(orderBy("updatedAt", "asc"), orderBy(documentId(), "asc"));
  if (request.after) {
    constraints.push(startAfter(request.after.updatedAt, request.after.entityId));
  }
  constraints.push(limit(pageSize));
  const snapshot = await getDocs(
    query(getEntityCollection(userId, entityType), ...constraints),
  );
  const inspected = inspectPulledSyncEnvelopes(
    entityType,
    snapshot.docs.map((entry) => ({ id: entry.id, data: entry.data() })),
  );
  if (callbacks.onValidationFailure) {
    for (const failure of inspected.validationFailures) {
      await callbacks.onValidationFailure(failure);
    }
  }
  await rewriteMigratedSyncEnvelopes(entityType, inspected.migrations, async (
    documentId,
    envelope,
  ) => {
    await setDoc(
      doc(getEntityCollection(userId, entityType), documentId),
      envelope,
      { merge: true },
    );
  });
  const lastDocument = snapshot.docs.at(-1);
  const lastUpdatedAt = lastDocument?.data()?.updatedAt;
  return {
    records: inspected.envelopes,
    nextCursor:
      lastDocument && typeof lastUpdatedAt === "number"
        ? { updatedAt: lastUpdatedAt, entityId: lastDocument.id }
        : null,
    hasMore: snapshot.docs.length === pageSize,
  };
};

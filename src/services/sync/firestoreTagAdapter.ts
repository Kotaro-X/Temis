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
  startAfter,
  where,
  type QueryConstraint,
} from "firebase/firestore";

import type { SyncPullCursor, TagRecord } from "../../types";
import { getFirebaseFirestore } from "./firebaseApp";
import { compareSyncVersions, SYNC_PAGE_SIZE } from "./syncCore";

const getTagCollection = (userId: string) =>
  collection(getFirebaseFirestore(), "users", userId, "tags");

export const pushTagRecord = async (
  userId: string,
  record: TagRecord,
): Promise<boolean> => {
  const firestore = getFirebaseFirestore();
  const documentRef = doc(getTagCollection(userId), record.id);
  const syncDocument = {
    ...record,
    isDeleted: record.deletedAt !== null,
  };
  return runTransaction(firestore, async (transaction) => {
    const currentSnapshot = await transaction.get(documentRef);
    if (currentSnapshot.exists()) {
      const current = currentSnapshot.data() as Partial<TagRecord>;
      if (
        typeof current.updatedAt === "number" &&
        compareSyncVersions(record, {
          updatedAt: current.updatedAt,
          deletedAt:
            typeof current.deletedAt === "number" ? current.deletedAt : null,
          deviceId: typeof current.deviceId === "string" ? current.deviceId : null,
        }) <= 0
      ) {
        return false;
      }
    }
    transaction.set(documentRef, syncDocument);
    return true;
  });
};

export const deleteTagRecord = async (
  userId: string,
  recordId: string,
): Promise<void> => {
  await deleteDoc(doc(getTagCollection(userId), recordId));
};

export const pullTagRecords = async (userId: string): Promise<TagRecord[]> => {
  const records: TagRecord[] = [];
  let after: SyncPullCursor | null = null;
  while (true) {
    const page = await pullTagRecordPage(userId, {
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

export const pullTagRecordPage = async (
  userId: string,
  request: {
    updatedAfter: number | null;
    after: SyncPullCursor | null;
    pageSize?: number;
  },
): Promise<{
  records: TagRecord[];
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
  const snapshot = await getDocs(query(getTagCollection(userId), ...constraints));
  const records = snapshot.docs
    .map((entry) => entry.data() as Partial<TagRecord>)
    .filter((entry) => typeof entry.id === "string" && typeof entry.name === "string")
    .map((entry) => ({
      id: entry.id as string,
      name: entry.name as string,
      order: typeof entry.order === "number" ? entry.order : 0,
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
      archivedAt: typeof entry.archivedAt === "number" ? entry.archivedAt : null,
      deletedAt: typeof entry.deletedAt === "number" ? entry.deletedAt : null,
      deviceId: typeof entry.deviceId === "string" ? entry.deviceId : null,
    }));
  const lastDocument = snapshot.docs.at(-1);
  const lastUpdatedAt = lastDocument?.data()?.updatedAt;
  return {
    records,
    nextCursor:
      lastDocument && typeof lastUpdatedAt === "number"
        ? { updatedAt: lastUpdatedAt, entityId: lastDocument.id }
        : null,
    hasMore: snapshot.docs.length === pageSize,
  };
};

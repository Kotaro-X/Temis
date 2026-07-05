import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";

import type { SyncEntityEnvelope, SyncEntityType } from "../../types";
import { getFirebaseFirestore } from "./firebaseApp";

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
): Promise<void> => {
  await setDoc(
    doc(getEntityCollection(userId, envelope.entityType), envelope.entityId),
    envelope,
    { merge: true },
  );
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
  const snapshot = await getDocs(getEntityCollection(userId, entityType));
  return snapshot.docs
    .map((entry) => entry.data() as Partial<SyncEntityEnvelope<TType>>)
    .filter(
      (entry) =>
        entry.entityType === entityType &&
        typeof entry.entityId === "string" &&
        typeof entry.updatedAt === "number",
    )
    .map((entry) => ({
      entityType,
      entityId: entry.entityId as string,
      record: entry.record as SyncEntityEnvelope<TType>["record"],
      updatedAt: entry.updatedAt as number,
      deletedAt:
        typeof entry.deletedAt === "number" ? entry.deletedAt : null,
      deviceId: typeof entry.deviceId === "string" ? entry.deviceId : null,
    }));
};

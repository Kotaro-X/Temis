import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";

import type { TagRecord } from "../../types";
import { getFirebaseFirestore } from "./firebaseApp";

const getTagCollection = (userId: string) =>
  collection(getFirebaseFirestore(), "users", userId, "tags");

export const pushTagRecord = async (
  userId: string,
  record: TagRecord,
): Promise<void> => {
  await setDoc(doc(getTagCollection(userId), record.id), record, { merge: true });
};

export const deleteTagRecord = async (
  userId: string,
  recordId: string,
): Promise<void> => {
  await deleteDoc(doc(getTagCollection(userId), recordId));
};

export const pullTagRecords = async (userId: string): Promise<TagRecord[]> => {
  const snapshot = await getDocs(getTagCollection(userId));
  return snapshot.docs
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
};

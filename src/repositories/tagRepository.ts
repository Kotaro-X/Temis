import { nanoid } from "nanoid/non-secure";

import {
  loadSyncQueue,
  loadTagRecords,
  saveSyncQueue,
  saveTagRecords,
} from "../../storage";
import { notifySyncQueueChanged } from "../services/sync/syncQueueEvents";
import type { SyncQueueItem, Tag, TagRecord } from "../types";

type TagState = {
  activeTags: Tag[];
  archivedTags: Tag[];
  records: TagRecord[];
};

const toTagState = (records: TagRecord[]): TagState => {
  const sorted = [...records].sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    return a.id.localeCompare(b.id);
  });

  return {
    activeTags: sorted
      .filter((record) => record.deletedAt === null && record.archivedAt === null)
      .map((record) => record.name),
    archivedTags: sorted
      .filter((record) => record.deletedAt === null && record.archivedAt !== null)
      .map((record) => record.name),
    records: sorted,
  };
};

const normalizeOrders = (records: TagRecord[]): TagRecord[] =>
  [...records]
    .sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }
      return a.id.localeCompare(b.id);
    })
    .map((record, index) => ({
      ...record,
      order: index,
    }));

const upsertQueueRecord = async (record: TagRecord): Promise<void> => {
  const queue = await loadSyncQueue();
  const now = Date.now();
  const existing = queue.find(
    (item) => item.entityType === "tag" && item.entityId === record.id,
  );
  const nextItem: SyncQueueItem<{ record: TagRecord }> = {
    id: existing?.id ?? nanoid(),
    entityType: "tag",
    entityId: record.id,
    operation: "upsert",
    payload: { record },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    attemptCount: existing?.attemptCount ?? 0,
    lastError: null,
    nextRetryAt: 0,
  };
  const nextQueue = queue.filter(
    (item) => !(item.entityType === "tag" && item.entityId === record.id),
  );
  nextQueue.push(nextItem);
  await saveSyncQueue(nextQueue);
  notifySyncQueueChanged();
};

const persistRecords = async (records: TagRecord[]): Promise<TagState> => {
  const normalized = normalizeOrders(records);
  await saveTagRecords(normalized);
  return toTagState(normalized);
};

const ensureUniqueName = (
  records: TagRecord[],
  name: string,
  excludeId?: string,
): boolean => {
  const trimmed = name.trim();
  if (!trimmed) {
    return false;
  }
  return !records.some(
    (record) =>
      record.deletedAt === null &&
      record.id !== excludeId &&
      record.name === trimmed,
  );
};

export const loadTags = async (): Promise<{
  activeTags: Tag[];
  archivedTags: Tag[];
}> => {
  const state = toTagState(await loadTagRecords());
  return { activeTags: state.activeTags, archivedTags: state.archivedTags };
};

export const loadTagState = async (): Promise<TagState> =>
  toTagState(await loadTagRecords());

export const persistTagState = async (params: {
  activeTags: Tag[];
  archivedTags: Tag[];
  deviceId?: string | null;
}): Promise<TagState> => {
  const existing = await loadTagRecords();
  const now = Date.now();
  const byId = new Map(existing.map((record) => [record.id, record]));
  const byName = new Map(existing.map((record) => [record.name, record]));
  const usedIds = new Set<string>();
  const nextRecords: TagRecord[] = [];

  const toRecord = (name: Tag, order: number, archived: boolean) => {
    const existingRecord =
      byName.get(name) ??
      [...byId.values()].find(
        (record) =>
          !usedIds.has(record.id) &&
          record.deletedAt === null &&
          record.name === name,
      );
    const record: TagRecord = {
      ...(existingRecord ?? {
        id: nanoid(),
        createdAt: now + order,
      }),
      name,
      order,
      updatedAt: now,
      archivedAt: archived ? now : null,
      deletedAt: null,
      deviceId: params.deviceId ?? existingRecord?.deviceId ?? null,
    };
    usedIds.add(record.id);
    nextRecords.push(record);
  };

  params.activeTags.forEach((name, index) => toRecord(name, index, false));
  params.archivedTags.forEach((name, index) =>
    toRecord(name, params.activeTags.length + index, true),
  );

  for (const record of existing) {
    if (usedIds.has(record.id)) {
      continue;
    }
    nextRecords.push({
      ...record,
      deletedAt: record.deletedAt ?? now,
      updatedAt: now,
      deviceId: params.deviceId ?? record.deviceId,
    });
  }

  return persistRecords(nextRecords);
};

export const saveTags = async (tags: Tag[]): Promise<void> => {
  const current = await loadTagState();
  await persistTagState({ activeTags: tags, archivedTags: current.archivedTags });
};

export const saveArchivedTags = async (tags: Tag[]): Promise<void> => {
  const current = await loadTagState();
  await persistTagState({ activeTags: current.activeTags, archivedTags: tags });
};

export const createTag = (tags: Tag[], name: string): Tag[] => {
  const trimmed = name.trim();
  if (!trimmed || tags.includes(trimmed)) {
    return tags;
  }
  return [...tags, trimmed];
};

export const updateTag = (
  tags: Tag[],
  current: Tag,
  nextName: string,
): Tag[] => {
  const trimmed = nextName.trim();
  if (!trimmed || current === trimmed) {
    return tags;
  }
  if (tags.includes(trimmed)) {
    return tags;
  }
  return tags.map((tag) => (tag === current ? trimmed : tag));
};

export const archiveTag = (
  activeTags: Tag[],
  archivedTags: Tag[],
  tag: Tag,
): { activeTags: Tag[]; archivedTags: Tag[] } => ({
  activeTags: activeTags.filter((item) => item !== tag),
  archivedTags: archivedTags.includes(tag) ? archivedTags : [...archivedTags, tag],
});

export const restoreTag = (
  activeTags: Tag[],
  archivedTags: Tag[],
  tag: Tag,
): { activeTags: Tag[]; archivedTags: Tag[] } => ({
  activeTags: activeTags.includes(tag) ? activeTags : [...activeTags, tag],
  archivedTags: archivedTags.filter((item) => item !== tag),
});

export const addTag = async (params: {
  name: string;
  deviceId?: string | null;
}): Promise<TagState> => {
  const current = await loadTagState();
  const trimmed = params.name.trim();
  if (!trimmed || !ensureUniqueName(current.records, trimmed)) {
    return current;
  }
  const now = Date.now();
  const record: TagRecord = {
    id: nanoid(),
    name: trimmed,
    order: current.records.length,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    deviceId: params.deviceId ?? null,
  };
  const next = await persistRecords([...current.records, record]);
  await upsertQueueRecord(record);
  return next;
};

export const renameTag = async (params: {
  current: Tag;
  nextName: string;
  deviceId?: string | null;
}): Promise<{ ok: boolean; state: TagState }> => {
  const currentState = await loadTagState();
  const record = currentState.records.find(
    (item) => item.deletedAt === null && item.name === params.current,
  );
  const trimmed = params.nextName.trim();
  if (!record || !trimmed) {
    return { ok: false, state: currentState };
  }
  if (trimmed === record.name) {
    return { ok: true, state: currentState };
  }
  if (!ensureUniqueName(currentState.records, trimmed, record.id)) {
    return { ok: false, state: currentState };
  }
  const nextRecord: TagRecord = {
    ...record,
    name: trimmed,
    updatedAt: Date.now(),
    deviceId: params.deviceId ?? record.deviceId,
  };
  const next = await persistRecords(
    currentState.records.map((item) => (item.id === record.id ? nextRecord : item)),
  );
  await upsertQueueRecord(nextRecord);
  return { ok: true, state: next };
};

export const setTagArchived = async (params: {
  tag: Tag;
  archived: boolean;
  deviceId?: string | null;
}): Promise<TagState> => {
  const current = await loadTagState();
  const record = current.records.find(
    (item) => item.deletedAt === null && item.name === params.tag,
  );
  if (!record) {
    return current;
  }
  const nextRecord: TagRecord = {
    ...record,
    archivedAt: params.archived ? Date.now() : null,
    updatedAt: Date.now(),
    deviceId: params.deviceId ?? record.deviceId,
  };
  const next = await persistRecords(
    current.records.map((item) => (item.id === record.id ? nextRecord : item)),
  );
  await upsertQueueRecord(nextRecord);
  return next;
};

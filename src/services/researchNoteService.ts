import AsyncStorage from "@react-native-async-storage/async-storage";
import { nanoid } from "nanoid/non-secure";

import { loadSyncDeviceId } from "../../storage";
import { Tag } from "../../types";
import { rebuildChunkIndexForDocument } from "../db/chunkIndexRepo";
import { ensureDbReady, executeSql } from "../db/sqlite";
import { rebuildTokenIndexForDocument } from "../db/tokenIndexRepo";
import { invalidateHybridSearchCache } from "../services/hybridSearch";
import {
  buildTankyuDocumentId,
  buildTankyuIndexText,
} from "../services/indexTextBuilder";
import { buildResearchSyncEnvelope } from "../services/sync/syncEntityModels";
import { persistAndEnqueueSyncEnvelope } from "../services/sync/syncEnvelopeStore";
import { WeeklyPrompt } from "../types/weeklyPrompt";
import { ResearchNote } from "../types/research";
import { getWeekStartMondayJstYmd } from "./dateJst";

const RESEARCH_NOTES_KEY = "researchNotes:";

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const normalizeResearchNote = (raw: unknown): ResearchNote | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Partial<ResearchNote>;
  if (typeof item.id !== "string") {
    return null;
  }
  if (typeof item.body !== "string") {
    return null;
  }
  return {
    id: item.id,
    title: typeof item.title === "string" ? item.title : "",
    body: item.body,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
    tags: normalizeStringArray(item.tags) as Tag[],
    weekId: typeof item.weekId === "string" ? item.weekId : "",
    weeklyPromptId: typeof item.weeklyPromptId === "string" ? item.weeklyPromptId : "",
  };
};

const loadRawNotes = async (): Promise<ResearchNote[]> => {
  const raw = await AsyncStorage.getItem(RESEARCH_NOTES_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => normalizeResearchNote(item))
      .filter((item): item is ResearchNote => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
};

const saveRawNotes = async (notes: ResearchNote[]): Promise<void> => {
  await AsyncStorage.setItem(RESEARCH_NOTES_KEY, JSON.stringify(notes));
};

const rebuildSearchIndexesForResearchNote = async (
  note: Pick<ResearchNote, "id" | "title" | "body">,
): Promise<void> => {
  await ensureDbReady();
  const documentId = buildTankyuDocumentId(note.id);
  const indexText = buildTankyuIndexText(note.title, note.body);
  await rebuildTokenIndexForDocument(documentId, indexText);
  await rebuildChunkIndexForDocument(documentId, indexText);
  invalidateHybridSearchCache();
};

export const listResearchNotes = async (): Promise<ResearchNote[]> => loadRawNotes();

export const getResearchNoteById = async (
  noteId: string,
): Promise<ResearchNote | null> => {
  const notes = await loadRawNotes();
  return notes.find((note) => note.id === noteId) ?? null;
};

export const upsertResearchNote = async (input: {
  id?: string;
  title: string;
  body: string;
  tags?: Tag[];
  weeklyPrompt?: WeeklyPrompt | null;
  enqueueSync?: boolean;
}): Promise<ResearchNote> => {
  const notes = await loadRawNotes();
  const now = Date.now();
  const trimmedTitle = input.title.trim();
  const shouldEnqueueSync = input.enqueueSync !== false;

  if (input.id) {
    const nextNotes = notes.map((note) => {
      if (note.id !== input.id) {
        return note;
      }
      return {
        ...note,
        title: trimmedTitle,
        body: input.body,
        updatedAt: now,
      };
    });
    await saveRawNotes(nextNotes);
    const updated = nextNotes.find((note) => note.id === input.id);
    if (!updated) {
      throw new Error("Research note not found.");
    }
    try {
      await rebuildSearchIndexesForResearchNote(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Index][Tankyu] rebuild failed noteId=${updated.id} ${message}`,
      );
    }
    if (shouldEnqueueSync) {
      const deviceId = await loadSyncDeviceId();
      await persistAndEnqueueSyncEnvelope(
        buildResearchSyncEnvelope({
          note: updated,
          deviceId,
        }),
      );
    }
    return updated;
  }

  const weekId = getWeekStartMondayJstYmd();
  const weeklyPromptId = input.weeklyPrompt?.id ?? "";
  const weeklyTag = input.weeklyPrompt
    ? `WEEKLY: ${input.weeklyPrompt.title}`
    : null;
  const baseTags = input.tags ?? [];
  const tags = weeklyTag && !baseTags.includes(weeklyTag)
    ? [...baseTags, weeklyTag]
    : [...baseTags];

  const created: ResearchNote = {
    id: nanoid(),
    title: trimmedTitle,
    body: input.body,
    createdAt: now,
    updatedAt: now,
    tags,
    weekId,
    weeklyPromptId,
  };
  const nextNotes = [created, ...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  await saveRawNotes(nextNotes);
  try {
    await rebuildSearchIndexesForResearchNote(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Index][Tankyu] rebuild failed noteId=${created.id} ${message}`);
  }
  if (shouldEnqueueSync) {
    const deviceId = await loadSyncDeviceId();
    await persistAndEnqueueSyncEnvelope(
      buildResearchSyncEnvelope({
        note: created,
        deviceId,
      }),
    );
  }
  return created;
};

export const upsertResearchNoteRecord = async (
  record: ResearchNote,
): Promise<ResearchNote> => {
  const notes = await loadRawNotes();
  const nextNotes = notes.some((note) => note.id === record.id)
    ? notes.map((note) => (note.id === record.id ? record : note))
    : [record, ...notes];
  await saveRawNotes(nextNotes.sort((a, b) => b.updatedAt - a.updatedAt));
  try {
    await rebuildSearchIndexesForResearchNote(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Index][Tankyu] rebuild failed noteId=${record.id} ${message}`);
  }
  return record;
};

export const deleteResearchNoteById = async (
  noteId: string,
  options?: { enqueueSync?: boolean },
): Promise<void> => {
  const notes = await loadRawNotes();
  const existing = notes.find((note) => note.id === noteId) ?? null;
  const next = notes.filter((note) => note.id !== noteId);
  await saveRawNotes(next);
  const documentId = buildTankyuDocumentId(noteId);
  try {
    await ensureDbReady();
    await executeSql("DELETE FROM token_index WHERE memo_id = ?", [documentId]);
    await executeSql("DELETE FROM chunk_index WHERE memo_id = ?", [documentId]);
    invalidateHybridSearchCache();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Index][Tankyu] delete failed noteId=${noteId} ${message}`);
  }
  if (options?.enqueueSync === false || !existing) {
    return;
  }
  const deviceId = await loadSyncDeviceId();
  await persistAndEnqueueSyncEnvelope(
    buildResearchSyncEnvelope({
      note: existing,
      deletedAt: Date.now(),
      deviceId,
    }),
  );
};

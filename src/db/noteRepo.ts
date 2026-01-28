import { nanoid } from "nanoid/non-secure";

import { extractTokens } from "../utils/wikiLink";
import { ensureDbReady, executeSql } from "./sqlite";

export type NoteType = "daily" | "free";

type NoteRow = {
  id: string;
  type: NoteType;
  date: string | null;
  title: string | null;
  body: string;
  updated_at: number;
};

type NoteLinkRow = {
  token: string;
};

export type NoteRecord = {
  id: string;
  type: NoteType;
  date: string | null;
  title: string | null;
  body: string;
  updatedAt: number;
};

export type FreeNoteSummary = {
  id: string;
  title: string | null;
  updatedAt: number;
};

const toNoteRecord = (row: NoteRow): NoteRecord => ({
  id: row.id,
  type: row.type,
  date: row.date,
  title: row.title,
  body: row.body,
  updatedAt: row.updated_at,
});

export const getDailyNoteByDate = async (
  date: string,
): Promise<NoteRecord | null> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, type, date, title, body, updated_at FROM notes WHERE type = 'daily' AND date = ? LIMIT 1",
    [date],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return toNoteRecord(result.rows.item(0) as NoteRow);
};

export const upsertDailyNote = async (
  date: string,
  body: string,
): Promise<NoteRecord> => {
  await ensureDbReady();
  const now = Date.now();
  const existing = await executeSql(
    "SELECT id FROM notes WHERE type = 'daily' AND date = ? LIMIT 1",
    [date],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows.item(0) as Pick<NoteRow, "id">;
    await executeSql(
      "UPDATE notes SET body = ?, updated_at = ? WHERE id = ?",
      [body, now, row.id],
    );
    await rebuildNoteLinks(row.id, body);
    return {
      id: row.id,
      type: "daily",
      date,
      title: null,
      body,
      updatedAt: now,
    };
  }
  const id = nanoid();
  await executeSql(
    "INSERT INTO notes (id, type, date, title, body, updated_at) VALUES (?, 'daily', ?, NULL, ?, ?)",
    [id, date, body, now],
  );
  await rebuildNoteLinks(id, body);
  return {
    id,
    type: "daily",
    date,
    title: null,
    body,
    updatedAt: now,
  };
};

export const listFreeNotes = async (): Promise<FreeNoteSummary[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, title, updated_at FROM notes WHERE type = 'free' ORDER BY updated_at DESC",
  );
  return (result.rows._array as Array<{
    id: string;
    title: string | null;
    updated_at: number;
  }>).map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
  }));
};

export const getFreeNoteById = async (
  noteId: string,
): Promise<NoteRecord | null> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT id, type, date, title, body, updated_at FROM notes WHERE type = 'free' AND id = ? LIMIT 1",
    [noteId],
  );
  if (result.rows.length === 0) {
    return null;
  }
  return toNoteRecord(result.rows.item(0) as NoteRow);
};

export const upsertFreeNote = async (input: {
  id?: string | null;
  title?: string | null;
  body: string;
}): Promise<NoteRecord> => {
  await ensureDbReady();
  const now = Date.now();
  const title = input.title ?? null;
  if (input.id) {
    await executeSql(
      "UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND type = 'free'",
      [title, input.body, now, input.id],
    );
    await rebuildNoteLinks(input.id, input.body);
    return {
      id: input.id,
      type: "free",
      date: null,
      title,
      body: input.body,
      updatedAt: now,
    };
  }
  const id = nanoid();
  await executeSql(
    "INSERT INTO notes (id, type, date, title, body, updated_at) VALUES (?, 'free', NULL, ?, ?, ?)",
    [id, title, input.body, now],
  );
  await rebuildNoteLinks(id, input.body);
  return {
    id,
    type: "free",
    date: null,
    title,
    body: input.body,
    updatedAt: now,
  };
};

export const rebuildNoteLinks = async (
  noteId: string,
  body: string,
): Promise<void> => {
  await ensureDbReady();
  const tokens = extractTokens(body);
  await executeSql("DELETE FROM note_links WHERE note_id = ?", [noteId]);
  if (tokens.length === 0) {
    return;
  }
  for (const token of tokens) {
    await executeSql(
      "INSERT INTO note_links (id, note_id, token) VALUES (?, ?, ?)",
      [nanoid(), noteId, token],
    );
  }
};

export const getTokensByNoteId = async (noteId: string): Promise<string[]> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT token FROM note_links WHERE note_id = ? ORDER BY token",
    [noteId],
  );
  return (result.rows._array as NoteLinkRow[]).map((row) => row.token);
};

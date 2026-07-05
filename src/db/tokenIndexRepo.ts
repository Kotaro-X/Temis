import { nanoid } from "nanoid/non-secure";

import {
  extractTokenOccurrences,
  normalizeParens,
  normalizeSearchToken,
} from "../utils/wikiLink";
import { ensureDbReady, executeSql } from "./sqlite";

type TokenIndexRow = {
  token: string;
  memo_id: string;
  created_at: number;
  updated_at: number;
  positions: string | null;
  snippet: string | null;
};

export type TokenIndexHit = {
  token: string;
  memoId: string;
  createdAt: number;
  updatedAt: number;
  positions: number[];
  snippet: string | null;
};

export type TokenIndexRebuildStats = {
  tokenCount: number;
  indexedTextLength: number;
};

const SNIPPET_RADIUS = 24;

const buildSnippet = (
  body: string,
  start: number,
  end: number,
): string | null => {
  if (!body) {
    return null;
  }
  const from = Math.max(0, start - SNIPPET_RADIUS);
  const to = Math.min(body.length, end + SNIPPET_RADIUS);
  const snippet = body.slice(from, to).replace(/\s+/g, " ").trim();
  return snippet || null;
};

const parsePositions = (value: string | null): number[] => {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is number => typeof item === "number");
  } catch {
    return [];
  }
};

export const rebuildTokenIndexForDocument = async (
  documentId: string,
  text: string,
): Promise<TokenIndexRebuildStats> => {
  await ensureDbReady();
  const normalizedBody = normalizeParens(text);
  const occurrences = extractTokenOccurrences(normalizedBody);
  await executeSql("DELETE FROM token_index WHERE memo_id = ?", [documentId]);
  if (occurrences.length === 0) {
    return {
      tokenCount: 0,
      indexedTextLength: normalizedBody.length,
    };
  }

  const now = Date.now();
  const grouped = new Map<
    string,
    { positions: number[]; snippet: string | null }
  >();
  for (const occurrence of occurrences) {
    const existing = grouped.get(occurrence.token);
    if (existing) {
      existing.positions.push(occurrence.start);
      continue;
    }
    grouped.set(occurrence.token, {
      positions: [occurrence.start],
      snippet: buildSnippet(normalizedBody, occurrence.start, occurrence.end),
    });
  }

  for (const [token, value] of grouped.entries()) {
    await executeSql(
      "INSERT INTO token_index (id, token, memo_id, created_at, updated_at, positions, snippet) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        nanoid(),
        token,
        documentId,
        now,
        now,
        JSON.stringify(value.positions),
        value.snippet,
      ],
    );
  }
  return {
    tokenCount: grouped.size,
    indexedTextLength: normalizedBody.length,
  };
};

export const rebuildTokenIndexForMemo = async (
  memoId: string,
  body: string,
): Promise<void> => {
  await rebuildTokenIndexForDocument(memoId, body);
};

export const searchByToken = async (
  token: string,
): Promise<TokenIndexHit[]> => {
  await ensureDbReady();
  const normalized = normalizeSearchToken(token);
  if (!normalized) {
    return [];
  }
  const result = await executeSql(
    "SELECT token, memo_id, created_at, updated_at, positions, snippet FROM token_index WHERE token = ? ORDER BY updated_at DESC",
    [normalized],
  );
  return (result.rows._array as TokenIndexRow[]).map((row) => ({
    token: row.token,
    memoId: row.memo_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    positions: parsePositions(row.positions),
    snippet: row.snippet,
  }));
};

export const searchByTokens = async (
  tokens: string[],
): Promise<TokenIndexHit[]> => {
  await ensureDbReady();
  const normalizedTokens = Array.from(
    new Set(tokens.map((token) => normalizeSearchToken(token)).filter(Boolean)),
  );
  if (normalizedTokens.length === 0) {
    return [];
  }
  const placeholders = normalizedTokens.map(() => "?").join(", ");
  const result = await executeSql(
    `SELECT token, memo_id, created_at, updated_at, positions, snippet FROM token_index WHERE token IN (${placeholders}) ORDER BY updated_at DESC`,
    normalizedTokens,
  );
  return (result.rows._array as TokenIndexRow[]).map((row) => ({
    token: row.token,
    memoId: row.memo_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    positions: parsePositions(row.positions),
    snippet: row.snippet,
  }));
};

export const getTokenIndexCountByDocumentId = async (
  documentId: string,
): Promise<number> => {
  await ensureDbReady();
  const result = await executeSql(
    "SELECT COUNT(1) as count FROM token_index WHERE memo_id = ?",
    [documentId],
  );
  const row = result.rows.item(0) as { count: number };
  return Number(row.count) || 0;
};

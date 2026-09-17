import {
  deleteDatabaseAsync,
  openDatabaseSync,
  type SQLiteDatabase,
} from "expo-sqlite";

import { runMigrations } from "./migrations";

const DB_NAME = "wememo.db";

let db: SQLiteDatabase | null = null;

const getDatabase = (): SQLiteDatabase => {
  if (!db) {
    db = openDatabaseSync(DB_NAME);
  }
  return db;
};

type SqlParams = Array<string | number | null>;

type SqlRow = Record<string, unknown>;

export type SqlResultSetRowList<T extends SqlRow = SqlRow> = {
  _array: T[];
  length: number;
  item: (index: number) => T;
};

export type SqlResultSet<T extends SqlRow = SqlRow> = {
  rows: SqlResultSetRowList<T>;
};

const toRowList = <T extends SqlRow>(rows: T[]): SqlResultSetRowList<T> => ({
  _array: rows,
  length: rows.length,
  item: (index: number) => rows[index],
});

export const executeSql = async (
  sql: string,
  params: SqlParams = [],
): Promise<SqlResultSet> => {
  const rows = await getDatabase().getAllAsync<SqlRow>(sql, params);
  return { rows: toRowList(rows) };
};

let readyPromise: Promise<void> | null = null;

export const ensureDbReady = async (): Promise<void> => {
  if (!readyPromise) {
    readyPromise = runMigrations(executeSql);
  }
  return readyPromise;
};

export const deleteLocalDatabase = async (): Promise<void> => {
  db?.closeSync();
  db = null;
  readyPromise = null;
  await deleteDatabaseAsync(DB_NAME);
};

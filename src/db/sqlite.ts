import { openDatabaseSync } from "expo-sqlite";

import { runMigrations } from "./migrations";

const DB_NAME = "wememo.db";

const db = openDatabaseSync(DB_NAME);

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
  const rows = await db.getAllAsync<SqlRow>(sql, params);
  return { rows: toRowList(rows) };
};

let readyPromise: Promise<void> | null = null;

export const ensureDbReady = async (): Promise<void> => {
  if (!readyPromise) {
    readyPromise = runMigrations(executeSql);
  }
  return readyPromise;
};

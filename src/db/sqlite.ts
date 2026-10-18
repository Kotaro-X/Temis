import { getEnvironmentEpoch } from "../services/environment/runtimeEnvironment";
import {
  deleteDatabaseAsync,
  openDatabaseSync,
  type SQLiteDatabase,
} from "expo-sqlite";

import { runMigrations } from "./migrations";
import { accountWorkspace } from "../services/account/accountWorkspace";

const DB_NAME = "wememo.db";

const databases = new Map<string, SQLiteDatabase>();
const databaseName = () => accountWorkspace.scope() === "legacy" ? DB_NAME
  : `wememo-account-${accountWorkspace.scope()}.db`;

const getDatabase = (): SQLiteDatabase => {
  const name = databaseName();
  let db = databases.get(name);
  if (!db) {
    db = openDatabaseSync(name);
    databases.set(name, db);
  }
  return db;
};

type SqlParams = (string | number | null)[];

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
  const epoch = getEnvironmentEpoch();
  await accountWorkspace.initialize();
  if (epoch !== getEnvironmentEpoch()) throw new Error("接続環境が切り替わりました。");
  const rows = await getDatabase().getAllAsync<SqlRow>(sql, params);
  if (epoch !== getEnvironmentEpoch()) throw new Error("接続環境が切り替わりました。");
  return { rows: toRowList(rows) };
};

const readyPromises = new Map<string, Promise<void>>();

export const ensureDbReady = async (): Promise<void> => {
  const epoch = getEnvironmentEpoch();
  await accountWorkspace.initialize();
  if (epoch !== getEnvironmentEpoch()) throw new Error("接続環境が切り替わりました。");
  const name = databaseName();
  let readyPromise = readyPromises.get(name);
  if (!readyPromise) {
    const database = getDatabase();
    readyPromise = runMigrations(async (sql, params = []) => {
      const rows = await database.getAllAsync<SqlRow>(sql, params);
      return { rows: toRowList(rows) };
    });
    readyPromises.set(name, readyPromise);
  }
  return readyPromise;
};

export const deleteLocalDatabase = async (): Promise<void> => {
  const epoch = getEnvironmentEpoch();
  await accountWorkspace.initialize();
  if (epoch !== getEnvironmentEpoch()) throw new Error("接続環境が切り替わりました。");
  for (const scope of accountWorkspace.databaseScopes()) {
    const name = scope === "legacy" ? DB_NAME : `wememo-account-${scope}.db`;
    // A recorded account may never have opened its database. Opening then
    // closing also makes deletion safe when its file is already absent.
    (databases.get(name) ?? openDatabaseSync(name)).closeSync();
    databases.delete(name);
    readyPromises.delete(name);
    await deleteDatabaseAsync(name);
  }
};

import test from "node:test";
import assert from "node:assert/strict";

import { MIGRATIONS, runMigrations } from "../src/db/migrations.ts";

type Row = Record<string, unknown>;
type SqlParams = Array<string | number | null>;
type TableSchema = {
  columns: string[];
};
type IndexSchema = {
  tableName: string;
  columns: string;
  unique: boolean;
};
type DbState = {
  tables: Map<string, TableSchema>;
  indexes: Map<string, IndexSchema>;
  appliedMigrations: Map<string, number>;
};

const cloneState = (state: DbState): DbState => ({
  tables: new Map(
    Array.from(state.tables.entries()).map(([name, schema]) => [
      name,
      { columns: [...schema.columns] },
    ]),
  ),
  indexes: new Map(
    Array.from(state.indexes.entries()).map(([name, schema]) => [
      name,
      { ...schema },
    ]),
  ),
  appliedMigrations: new Map(state.appliedMigrations),
});

const splitColumnDefinitions = (definitionSql: string): string[] =>
  definitionSql.split(",").map((part) => part.trim()).filter(Boolean);

class FakeSqlite {
  statements: string[] = [];
  failOnceOn: string | null = null;

  private state: DbState = {
    tables: new Map(),
    indexes: new Map(),
    appliedMigrations: new Map(),
  };

  private transactionSnapshot: DbState | null = null;

  async execute(sql: string, params: SqlParams = []): Promise<{
    rows: { _array: Row[]; length: number; item: (index: number) => Row };
  }> {
    this.statements.push(sql);
    if (this.failOnceOn && sql.includes(this.failOnceOn)) {
      this.failOnceOn = null;
      throw new Error(`planned failure for ${sql}`);
    }

    const rows = this.apply(sql, params);
    return {
      rows: {
        _array: rows,
        length: rows.length,
        item: (index: number) => rows[index],
      },
    };
  }

  seedLegacyMemoAndChunkSchema(): void {
    this.createTable(
      "CREATE TABLE IF NOT EXISTS memos (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    );
    this.createTable(
      "CREATE TABLE IF NOT EXISTS memo_links (id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, token TEXT NOT NULL)",
    );
    this.createTable(
      "CREATE TABLE IF NOT EXISTS chunk_index (chunk_id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, tags TEXT, embedding TEXT NOT NULL, embedding_model TEXT, embedding_dim INTEGER, embedded_at INTEGER)",
    );
  }

  markAppliedThrough(version: string): void {
    this.createTable(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
    );
    for (const migration of MIGRATIONS) {
      this.state.appliedMigrations.set(migration.version, Date.now());
      if (migration.version === version) {
        return;
      }
    }
  }

  hasColumn(tableName: string, columnName: string): boolean {
    return this.state.tables.get(tableName)?.columns.includes(columnName) ?? false;
  }

  hasMigration(version: string): boolean {
    return this.state.appliedMigrations.has(version);
  }

  migrationCount(): number {
    return this.state.appliedMigrations.size;
  }

  schemaSignature(): string {
    const tables = Array.from(this.state.tables.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, schema]) => `${name}(${schema.columns.join(",")})`);
    const indexes = Array.from(this.state.indexes.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([name, schema]) =>
          `${schema.unique ? "unique " : ""}${name} ON ${schema.tableName}(${schema.columns})`,
      );
    return [...tables, ...indexes].join("\n");
  }

  private apply(sql: string, params: SqlParams): Row[] {
    if (sql === "BEGIN IMMEDIATE TRANSACTION") {
      assert.equal(this.transactionSnapshot, null);
      this.transactionSnapshot = cloneState(this.state);
      return [];
    }
    if (sql === "COMMIT") {
      assert.notEqual(this.transactionSnapshot, null);
      this.transactionSnapshot = null;
      return [];
    }
    if (sql === "ROLLBACK") {
      if (!this.transactionSnapshot) {
        throw new Error("ROLLBACK without transaction");
      }
      this.state = this.transactionSnapshot;
      this.transactionSnapshot = null;
      return [];
    }
    if (sql.startsWith("SELECT name FROM sqlite_master")) {
      return Array.from(this.state.tables.keys()).map((name) => ({ name }));
    }
    if (sql.startsWith("SELECT version FROM schema_migrations")) {
      return Array.from(this.state.appliedMigrations.keys())
        .sort()
        .map((version) => ({ version }));
    }
    if (sql.startsWith("PRAGMA table_info(")) {
      const tableName = sql.slice("PRAGMA table_info(".length, -1);
      return (this.state.tables.get(tableName)?.columns ?? []).map((name) => ({
        name,
      }));
    }
    if (sql.startsWith("CREATE TABLE IF NOT EXISTS")) {
      this.createTable(sql);
      return [];
    }
    if (sql.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS")) {
      this.createIndex(sql, true);
      return [];
    }
    if (sql.startsWith("CREATE INDEX IF NOT EXISTS")) {
      this.createIndex(sql, false);
      return [];
    }
    if (sql.startsWith("ALTER TABLE")) {
      const match = sql.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+) /);
      assert.ok(match, `Unsupported ALTER TABLE SQL: ${sql}`);
      const [, tableName, columnName] = match;
      const table = this.state.tables.get(tableName);
      assert.ok(table, `Missing table ${tableName}`);
      if (!table.columns.includes(columnName)) {
        table.columns.push(columnName);
      }
      return [];
    }
    if (sql.startsWith("INSERT INTO schema_migrations")) {
      const version = params[0];
      const appliedAt = params[1];
      if (typeof version !== "string" || typeof appliedAt !== "number") {
        throw new Error("Invalid schema_migrations params");
      }
      this.state.appliedMigrations.set(version, appliedAt);
      return [];
    }
    return [];
  }

  private createTable(sql: string): void {
    const match = sql.match(/^CREATE TABLE IF NOT EXISTS (\w+) \((.*)\)$/);
    assert.ok(match, `Unsupported CREATE TABLE SQL: ${sql}`);
    const [, tableName, definitionSql] = match;
    if (this.state.tables.has(tableName)) {
      return;
    }
    const columns = splitColumnDefinitions(definitionSql)
      .map((definition) => definition.split(/\s+/)[0])
      .filter((columnName) => columnName !== "PRIMARY");
    this.state.tables.set(tableName, { columns });
  }

  private createIndex(sql: string, unique: boolean): void {
    const match = sql.match(
      /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)\((.*)\)$/,
    );
    assert.ok(match, `Unsupported CREATE INDEX SQL: ${sql}`);
    const [, indexName, tableName, columns] = match;
    this.state.indexes.set(indexName, { tableName, columns, unique });
  }
}

test("new database starts on the latest schema", async () => {
  const db = new FakeSqlite();

  await runMigrations(db.execute.bind(db));

  assert.equal(db.hasColumn("chunk_index", "embedding_model_version"), true);
  assert.equal(db.hasColumn("embedding_jobs", "next_run_at"), true);
  assert.equal(db.hasColumn("notes", "updated_at"), true);
  assert.equal(db.migrationCount(), MIGRATIONS.length);
});

test("legacy database migrates to the same schema as a fresh database", async () => {
  const freshDb = new FakeSqlite();
  const legacyDb = new FakeSqlite();
  legacyDb.seedLegacyMemoAndChunkSchema();

  await runMigrations(freshDb.execute.bind(freshDb));
  await runMigrations(legacyDb.execute.bind(legacyDb));

  assert.equal(legacyDb.schemaSignature(), freshDb.schemaSignature());
  assert.equal(legacyDb.migrationCount(), MIGRATIONS.length);
});

test("already applied migrations are not executed again", async () => {
  const db = new FakeSqlite();
  db.seedLegacyMemoAndChunkSchema();

  await runMigrations(db.execute.bind(db));
  const firstRunStatementCount = db.statements.length;

  await runMigrations(db.execute.bind(db));
  const secondRunStatements = db.statements.slice(firstRunStatementCount);

  assert.equal(
    secondRunStatements.some((sql) => sql === "BEGIN IMMEDIATE TRANSACTION"),
    false,
  );
  assert.equal(
    secondRunStatements.some((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS memos"),
    ),
    false,
  );
  assert.equal(
    secondRunStatements.some((sql) => sql.startsWith("ALTER TABLE")),
    false,
  );
});

test("failed migration rolls back and is not recorded", async () => {
  const db = new FakeSqlite();
  db.seedLegacyMemoAndChunkSchema();
  db.markAppliedThrough("003_create_chunk_index");
  db.failOnceOn = "embedding_model_version TEXT";

  await assert.rejects(() => runMigrations(db.execute.bind(db)));

  assert.equal(db.hasColumn("chunk_index", "embedding_status"), false);
  assert.equal(db.hasColumn("chunk_index", "embedding_model_version"), false);
  assert.equal(db.hasMigration("004_add_chunk_embedding_metadata"), false);
});

test("failed migration can be retried successfully", async () => {
  const db = new FakeSqlite();
  db.seedLegacyMemoAndChunkSchema();
  db.markAppliedThrough("003_create_chunk_index");
  db.failOnceOn = "embedding_model_version TEXT";

  await assert.rejects(() => runMigrations(db.execute.bind(db)));
  await runMigrations(db.execute.bind(db));

  assert.equal(db.hasColumn("chunk_index", "embedding_status"), true);
  assert.equal(db.hasColumn("chunk_index", "embedding_model_version"), true);
  assert.equal(db.hasMigration("004_add_chunk_embedding_metadata"), true);
  assert.equal(db.migrationCount(), MIGRATIONS.length);
});

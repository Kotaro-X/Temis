type SqlParams = Array<string | number | null>;

type SqlExecutor = (sql: string, params?: SqlParams) => Promise<unknown>;
type SqlTableInfoRow = { name: string };
type SqlNameRow = { name: string };
type SqlVersionRow = { version: string };
type SqlResultLike<T> = { rows?: { _array?: T[] } };

export type Migration = {
  version: string;
  up: (executeSql: SqlExecutor) => Promise<void>;
};

const SCHEMA_MIGRATIONS_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)";

const createMemoTables = async (executeSql: SqlExecutor): Promise<void> => {
  await executeSql(
    "CREATE TABLE IF NOT EXISTS memos (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  await executeSql(
    "CREATE TABLE IF NOT EXISTS memo_links (id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, token TEXT NOT NULL)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_memos_task_id ON memos(task_id)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_memo_links_token ON memo_links(token)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_memo_links_memo_id ON memo_links(memo_id)",
  );
};

const createTokenIndex = async (executeSql: SqlExecutor): Promise<void> => {
  await executeSql(
    "CREATE TABLE IF NOT EXISTS token_index (id TEXT PRIMARY KEY, token TEXT NOT NULL, memo_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, positions TEXT, snippet TEXT)",
  );
  await executeSql(
    "INSERT INTO token_index (id, token, memo_id, created_at, updated_at, positions, snippet) SELECT lower(hex(randomblob(16))), ml.token, ml.memo_id, m.created_at, m.updated_at, NULL, NULL FROM memo_links ml JOIN memos m ON m.id = ml.memo_id WHERE NOT EXISTS (SELECT 1 FROM token_index ti WHERE ti.memo_id = ml.memo_id AND ti.token = ml.token)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_token_index_token ON token_index(token)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_token_index_memo_id ON token_index(memo_id)",
  );
};

const createChunkIndexBase = async (executeSql: SqlExecutor): Promise<void> => {
  await executeSql(
    "CREATE TABLE IF NOT EXISTS chunk_index (chunk_id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, tags TEXT, embedding TEXT NOT NULL, embedding_model TEXT, embedding_dim INTEGER, embedded_at INTEGER)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_memo_id ON chunk_index(memo_id)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_embedding_model ON chunk_index(embedding_model)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_embedding_model_dim ON chunk_index(embedding_model, embedding_dim)",
  );
};

const hasColumn = async (
  executeSql: SqlExecutor,
  tableName: string,
  columnName: string,
): Promise<boolean> => {
  const result = (await executeSql(
    `PRAGMA table_info(${tableName})`,
  )) as SqlResultLike<SqlTableInfoRow>;
  const rows = result.rows?._array ?? [];
  return rows.some((row) => row.name === columnName);
};

const addColumnIfMissing = async (
  executeSql: SqlExecutor,
  tableName: string,
  columnName: string,
  sqlType: string,
): Promise<void> => {
  const exists = await hasColumn(executeSql, tableName, columnName);
  if (exists) {
    return;
  }
  await executeSql(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType}`,
  );
};

const addChunkEmbeddingMetadata = async (
  executeSql: SqlExecutor,
): Promise<void> => {
  await addColumnIfMissing(
    executeSql,
    "chunk_index",
    "embedding_model",
    "TEXT",
  );
  await addColumnIfMissing(
    executeSql,
    "chunk_index",
    "embedding_dim",
    "INTEGER",
  );
  await addColumnIfMissing(
    executeSql,
    "chunk_index",
    "embedded_at",
    "INTEGER",
  );
  await addColumnIfMissing(
    executeSql,
    "chunk_index",
    "embedding_status",
    "TEXT NOT NULL DEFAULT 'completed'",
  );
  await addColumnIfMissing(
    executeSql,
    "chunk_index",
    "embedding_model_version",
    "TEXT",
  );
  await addColumnIfMissing(
    executeSql,
    "chunk_index",
    "embedding_error",
    "TEXT",
  );
  await addColumnIfMissing(
    executeSql,
    "chunk_index",
    "embedding_attempts",
    "INTEGER NOT NULL DEFAULT 0",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_embedding_status ON chunk_index(embedding_status)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_embedding_model_version ON chunk_index(embedding_model_version)",
  );
};

const createEmbeddingJobs = async (executeSql: SqlExecutor): Promise<void> => {
  await executeSql(
    "CREATE TABLE IF NOT EXISTS embedding_jobs (id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL, embedding_model_version TEXT NOT NULL, next_run_at INTEGER NOT NULL, locked_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  await executeSql(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_jobs_memo_version ON embedding_jobs(memo_id, embedding_model_version)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_embedding_jobs_status_next_run ON embedding_jobs(status, next_run_at)",
  );
  await executeSql(
    "CREATE TABLE IF NOT EXISTS embedding_rebuild_progress (job_key TEXT PRIMARY KEY, status TEXT NOT NULL, embedding_model_version TEXT NOT NULL, cursor_memo_id TEXT, total_memos INTEGER NOT NULL, processed_memos INTEGER NOT NULL, enqueued_memos INTEGER NOT NULL, force INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
};

const createBackfillProgress = async (executeSql: SqlExecutor): Promise<void> => {
  await executeSql(
    "CREATE TABLE IF NOT EXISTS index_backfill_progress (job_key TEXT PRIMARY KEY, total INTEGER NOT NULL, processed INTEGER NOT NULL, reindexed INTEGER NOT NULL, skipped INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  await executeSql(
    "CREATE TABLE IF NOT EXISTS embedding_backfill_progress (job_key TEXT PRIMARY KEY, batch_size INTEGER NOT NULL, processed_chunks INTEGER NOT NULL, reindexed_docs INTEGER NOT NULL, skipped_docs INTEGER NOT NULL, error_count INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  await executeSql(
    "CREATE TABLE IF NOT EXISTS embedding_backfill_errors (id TEXT PRIMARY KEY, job_key TEXT NOT NULL, document_id TEXT NOT NULL, chunk_id TEXT, message TEXT NOT NULL, created_at INTEGER NOT NULL)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_embedding_backfill_errors_job_key ON embedding_backfill_errors(job_key)",
  );
};

const createNotesTables = async (executeSql: SqlExecutor): Promise<void> => {
  await executeSql(
    "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, type TEXT NOT NULL, date TEXT, title TEXT, body TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_notes_type_date ON notes(type, date)",
  );
  await executeSql(
    "CREATE TABLE IF NOT EXISTS note_links (id TEXT PRIMARY KEY, note_id TEXT NOT NULL, token TEXT NOT NULL)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_note_links_note_id ON note_links(note_id)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_note_links_token ON note_links(token)",
  );
};

export const MIGRATIONS: Migration[] = [
  {
    version: "001_create_memo_tables",
    up: createMemoTables,
  },
  {
    version: "002_create_token_index",
    up: createTokenIndex,
  },
  {
    version: "003_create_chunk_index",
    up: createChunkIndexBase,
  },
  {
    version: "004_add_chunk_embedding_metadata",
    up: addChunkEmbeddingMetadata,
  },
  {
    version: "005_create_embedding_jobs",
    up: createEmbeddingJobs,
  },
  {
    version: "006_create_backfill_progress",
    up: createBackfillProgress,
  },
  {
    version: "007_create_notes_tables",
    up: createNotesTables,
  },
];

const createLatestSchema = async (executeSql: SqlExecutor): Promise<void> => {
  await createMemoTables(executeSql);
  await createTokenIndex(executeSql);
  await executeSql(
    "CREATE TABLE IF NOT EXISTS chunk_index (chunk_id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, tags TEXT, embedding TEXT NOT NULL, embedding_model TEXT, embedding_dim INTEGER, embedded_at INTEGER, embedding_status TEXT NOT NULL DEFAULT 'completed', embedding_model_version TEXT, embedding_error TEXT, embedding_attempts INTEGER NOT NULL DEFAULT 0)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_memo_id ON chunk_index(memo_id)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_embedding_model ON chunk_index(embedding_model)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_embedding_model_dim ON chunk_index(embedding_model, embedding_dim)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_embedding_status ON chunk_index(embedding_status)",
  );
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_chunk_index_embedding_model_version ON chunk_index(embedding_model_version)",
  );
  await createEmbeddingJobs(executeSql);
  await createBackfillProgress(executeSql);
  await createNotesTables(executeSql);
};

const listUserTables = async (executeSql: SqlExecutor): Promise<string[]> => {
  const result = (await executeSql(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  )) as SqlResultLike<SqlNameRow>;
  return (result.rows?._array ?? []).map((row) => row.name);
};

const listAppliedMigrations = async (
  executeSql: SqlExecutor,
): Promise<Set<string>> => {
  const result = (await executeSql(
    "SELECT version FROM schema_migrations ORDER BY version ASC",
  )) as SqlResultLike<SqlVersionRow>;
  return new Set((result.rows?._array ?? []).map((row) => row.version));
};

const recordMigration = async (
  executeSql: SqlExecutor,
  version: string,
): Promise<void> => {
  await executeSql(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    [version, Date.now()],
  );
};

const beginMigration = async (executeSql: SqlExecutor): Promise<void> => {
  await executeSql("BEGIN IMMEDIATE TRANSACTION");
};

const commitMigration = async (executeSql: SqlExecutor): Promise<void> => {
  await executeSql("COMMIT");
};

const rollbackMigration = async (executeSql: SqlExecutor): Promise<void> => {
  await executeSql("ROLLBACK");
};

export const runMigrations = async (
  executeSql: SqlExecutor,
): Promise<void> => {
  const existingTables = await listUserTables(executeSql);
  if (existingTables.length === 0) {
    await beginMigration(executeSql);
    try {
      await executeSql(SCHEMA_MIGRATIONS_TABLE_SQL);
      await createLatestSchema(executeSql);
      for (const migration of MIGRATIONS) {
        await recordMigration(executeSql, migration.version);
      }
      await commitMigration(executeSql);
    } catch (error) {
      await rollbackMigration(executeSql);
      throw error;
    }
    return;
  }

  await executeSql(SCHEMA_MIGRATIONS_TABLE_SQL);
  const appliedMigrations = await listAppliedMigrations(executeSql);
  for (const migration of MIGRATIONS) {
    if (appliedMigrations.has(migration.version)) {
      continue;
    }
    await beginMigration(executeSql);
    try {
      await migration.up(executeSql);
      await recordMigration(executeSql, migration.version);
      await commitMigration(executeSql);
      appliedMigrations.add(migration.version);
    } catch (error) {
      await rollbackMigration(executeSql);
      throw error;
    }
  }
};

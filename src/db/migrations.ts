type SqlParams = Array<string | number | null>;

type SqlExecutor = (sql: string, params?: SqlParams) => Promise<unknown>;
type SqlTableInfoRow = { name: string };
type SqlResultLike = { rows?: { _array?: SqlTableInfoRow[] } };

const hasColumn = async (
  executeSql: SqlExecutor,
  tableName: string,
  columnName: string,
): Promise<boolean> => {
  const result = (await executeSql(
    `PRAGMA table_info(${tableName})`,
  )) as SqlResultLike;
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

export const runMigrations = async (executeSql: SqlExecutor): Promise<void> => {
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
  await executeSql(
    "CREATE TABLE IF NOT EXISTS chunk_index (chunk_id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL, tags TEXT, embedding TEXT NOT NULL, embedding_model TEXT, embedding_dim INTEGER, embedded_at INTEGER)",
  );
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

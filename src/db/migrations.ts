type SqlParams = Array<string | number | null>;

type SqlExecutor = (sql: string, params?: SqlParams) => Promise<unknown>;

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

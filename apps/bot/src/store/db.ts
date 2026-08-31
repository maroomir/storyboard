import Database from 'better-sqlite3';

export type BotDatabase = Database.Database;

// Opens the embedded SQLite state store in WAL mode (AD §4.4.3). Single-process access means no
// lock contention. Pass ":memory:" for tests. Schema is created idempotently on open.
export function openDatabase(path: string): BotDatabase {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: BotDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gen_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      class TEXT NOT NULL,
      target TEXT NOT NULL,
      target_key TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL,
      failure_reason TEXT,
      provider TEXT NOT NULL DEFAULT '{}',
      chat_id INTEGER NOT NULL,
      progress_message_id INTEGER,
      usage TEXT NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"costUsd":0}',
      result_ref TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_gen_jobs_state ON gen_jobs (state);
    CREATE INDEX IF NOT EXISTS idx_gen_jobs_target_key ON gen_jobs (target_key);
    CREATE INDEX IF NOT EXISTS idx_gen_jobs_created_at ON gen_jobs (created_at);

    CREATE TABLE IF NOT EXISTS usage_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      task_name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      recorded_at INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES gen_jobs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_usage_ledger_job ON usage_ledger (job_id);
    CREATE INDEX IF NOT EXISTS idx_usage_ledger_recorded_at ON usage_ledger (recorded_at);

    CREATE TABLE IF NOT EXISTS gen_job_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      level TEXT NOT NULL,
      stage TEXT NOT NULL,
      message TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES gen_jobs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_gen_job_log_job ON gen_job_log (job_id);
  `);
}

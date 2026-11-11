export type CacheTableName =
  | 'sessions'
  | 'runs'
  | 'usage'
  | 'element_index'
  | 'lock'
  | 'findings'
  | 'journal'
  | 'chapter_summaries'
  | 'revision_plans';

export const cacheDatabaseSchemaVersion: number = 1;

export const cacheTableDefinitions: Record<CacheTableName, readonly string[]> = {
  sessions: [
    `CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      element_id TEXT,
      opened_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      pending_count INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    )`,
    'CREATE INDEX sessions_by_element ON sessions (element_id, opened_at)',
  ],
  runs: [
    `CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    )`,
    'CREATE INDEX runs_by_kind ON runs (kind, updated_at)',
  ],
  usage: [
    `CREATE TABLE usage (
      id TEXT PRIMARY KEY,
      recorded_at TEXT NOT NULL,
      task TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      data TEXT NOT NULL
    )`,
    'CREATE INDEX usage_by_time ON usage (recorded_at)',
  ],
  element_index: [
    `CREATE TABLE element_index (
      path TEXT PRIMARY KEY,
      uuid TEXT NOT NULL,
      kind TEXT NOT NULL,
      slug TEXT NOT NULL,
      card_hash TEXT NOT NULL
    )`,
    'CREATE INDEX element_index_by_uuid ON element_index (uuid)',
    'CREATE INDEX element_index_by_slug ON element_index (kind, slug)',
  ],
  lock: [
    `CREATE TABLE lock (
      slot INTEGER PRIMARY KEY CHECK (slot = 1),
      token TEXT NOT NULL,
      owner TEXT NOT NULL,
      label TEXT NOT NULL,
      pid INTEGER NOT NULL,
      hostname TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL
    )`,
  ],
  findings: [
    `CREATE TABLE findings (
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      input_hash TEXT,
      recorded_at TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (kind, subject)
    )`,
  ],
  journal: [
    `CREATE TABLE journal (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      completed_steps INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL
    )`,
  ],
  chapter_summaries: [
    `CREATE TABLE chapter_summaries (
      thread TEXT NOT NULL,
      chapter TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      summary TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (thread, chapter)
    )`,
  ],
  revision_plans: [
    `CREATE TABLE revision_plans (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL
    )`,
  ],
};

export const cacheTableNames: readonly CacheTableName[] = [
  'sessions',
  'runs',
  'usage',
  'element_index',
  'lock',
  'findings',
  'journal',
  'chapter_summaries',
  'revision_plans',
];

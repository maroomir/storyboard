import type { StorygramDatabase } from './db';

// Persisted wizard progress (AD §5.1.3, IAccessSession). Sessions survive restarts and app
// switches so a multi-step edit can resume (QA-05).
export interface WizardSession {
  readonly id: string;
  readonly chatId: number;
  readonly defId: string;
  readonly cursor: string;
  readonly data: Record<string, unknown>;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ISessionStore {
  save(session: WizardSession): void;
  load(id: string): WizardSession | undefined;
  findActiveByChat(chatId: number): WizardSession | undefined;
  delete(id: string): void;
  deleteExpired(now: number): number;
}

interface SessionRow {
  readonly id: string;
  readonly chat_id: number;
  readonly def_id: string;
  readonly cursor: string;
  readonly data: string;
  readonly created_at: number;
  readonly expires_at: number;
}

export class SqliteSessionStore implements ISessionStore {
  public constructor(private readonly db: StorygramDatabase) {}

  public save(session: WizardSession): void {
    this.db
      .prepare(
        `INSERT INTO wizard_sessions (id, chat_id, def_id, cursor, data, created_at, expires_at)
         VALUES (@id, @chatId, @defId, @cursor, @data, @createdAt, @expiresAt)
         ON CONFLICT(id) DO UPDATE SET cursor = @cursor, data = @data, expires_at = @expiresAt`,
      )
      .run({
        id: session.id,
        chatId: session.chatId,
        defId: session.defId,
        cursor: session.cursor,
        data: JSON.stringify(session.data),
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      });
  }

  public load(id: string): WizardSession | undefined {
    const row = this.db.prepare(`SELECT * FROM wizard_sessions WHERE id = ?`).get(id) as
      | SessionRow
      | undefined;
    return row ? toSession(row) : undefined;
  }

  // At most one active wizard per chat is expected (start() clears the previous one); the newest
  // row wins if that invariant is ever broken.
  public findActiveByChat(chatId: number): WizardSession | undefined {
    const row = this.db
      .prepare(`SELECT * FROM wizard_sessions WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(chatId) as SessionRow | undefined;
    return row ? toSession(row) : undefined;
  }

  public delete(id: string): void {
    this.db.prepare(`DELETE FROM wizard_sessions WHERE id = ?`).run(id);
  }

  public deleteExpired(now: number): number {
    return this.db.prepare(`DELETE FROM wizard_sessions WHERE expires_at < ?`).run(now).changes;
  }
}

function toSession(row: SessionRow): WizardSession {
  return {
    id: row.id,
    chatId: row.chat_id,
    defId: row.def_id,
    cursor: row.cursor,
    data: JSON.parse(row.data) as Record<string, unknown>,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

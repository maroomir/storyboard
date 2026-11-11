import { randomUUID } from 'node:crypto';

import type { SqlRow, SqlValue } from '#engine/ports/sqlDatabase';
import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';

export type SessionKind = 'studio' | 'interview' | 'absorb';

export const sessionKinds: readonly SessionKind[] = ['studio', 'interview', 'absorb'];

export interface SessionRecord {
  readonly id: string;
  readonly kind: SessionKind;
  readonly elementId?: string;
  readonly openedAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
  readonly pendingCount: number;
  readonly data: unknown;
}

export interface OpenSessionRequest {
  readonly kind: SessionKind;
  readonly elementId?: string;
  readonly data: unknown;
  readonly pendingCount?: number;
}

export interface UpdateSessionRequest {
  readonly data: unknown;
  readonly pendingCount: number;
}

function isSessionKind(value: string): value is SessionKind {
  return (sessionKinds as readonly string[]).includes(value);
}

function optionalText(value: SqlValue | undefined): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toSessionRecord(row: SqlRow): SessionRecord | undefined {
  const kind: string = String(row.kind);
  if (!isSessionKind(kind)) {
    return undefined;
  }

  const elementId: string | undefined = optionalText(row.element_id);
  const closedAt: string | undefined = optionalText(row.closed_at);

  return {
    id: String(row.id),
    kind,
    ...(elementId === undefined ? {} : { elementId }),
    openedAt: String(row.opened_at),
    updatedAt: String(row.updated_at),
    ...(closedAt === undefined ? {} : { closedAt }),
    pendingCount: Number(row.pending_count),
    data: JSON.parse(String(row.data)),
  };
}

function toSessionRecords(rows: readonly SqlRow[]): readonly SessionRecord[] {
  return rows.flatMap((row): SessionRecord[] => {
    const record: SessionRecord | undefined = toSessionRecord(row);
    return record === undefined ? [] : [record];
  });
}

export class SessionStore {
  public constructor(
    private readonly database: CacheDatabase,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  public open(request: OpenSessionRequest): SessionRecord {
    const openedAt: string = this.now().toISOString();
    const record: SessionRecord = {
      id: randomUUID(),
      kind: request.kind,
      ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
      openedAt,
      updatedAt: openedAt,
      pendingCount: request.pendingCount ?? 0,
      data: request.data,
    };
    this.database.run(
      `INSERT INTO sessions (id, kind, element_id, opened_at, updated_at, closed_at, pending_count, data)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        record.id,
        record.kind,
        record.elementId ?? null,
        openedAt,
        openedAt,
        record.pendingCount,
        JSON.stringify(record.data),
      ],
    );

    return record;
  }

  public update(sessionId: string, request: UpdateSessionRequest): void {
    this.database.run(
      'UPDATE sessions SET data = ?, pending_count = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(request.data), request.pendingCount, this.now().toISOString(), sessionId],
    );
  }

  public close(sessionId: string): void {
    const closedAt: string = this.now().toISOString();
    this.database.run('UPDATE sessions SET closed_at = ?, updated_at = ? WHERE id = ?', [
      closedAt,
      closedAt,
      sessionId,
    ]);
  }

  public find(sessionId: string): SessionRecord | undefined {
    const row: SqlRow | undefined = this.database.first('SELECT * FROM sessions WHERE id = ?', [
      sessionId,
    ]);
    return row === undefined ? undefined : toSessionRecord(row);
  }

  public listForElement(elementId: string): readonly SessionRecord[] {
    return toSessionRecords(
      this.database.all('SELECT * FROM sessions WHERE element_id = ? ORDER BY opened_at, id', [
        elementId,
      ]),
    );
  }

  public listWithPending(): readonly SessionRecord[] {
    return toSessionRecords(
      this.database.all('SELECT * FROM sessions WHERE pending_count > 0 ORDER BY opened_at, id'),
    );
  }

  public findOpen(kind: SessionKind, elementId?: string): SessionRecord | undefined {
    const row: SqlRow | undefined = this.database.first(
      `SELECT * FROM sessions WHERE kind = ? AND closed_at IS NULL AND element_id IS ?
       ORDER BY opened_at DESC LIMIT 1`,
      [kind, elementId ?? null],
    );

    return row === undefined ? undefined : toSessionRecord(row);
  }
}

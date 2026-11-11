import type { SqlRow, SqlValue } from '#engine/ports/sqlDatabase';
import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';

export type FindingKind = 'background-conflict';

export const findingKinds: readonly FindingKind[] = ['background-conflict'];

export interface Finding {
  readonly kind: FindingKind;
  readonly subject: string;
  readonly inputHash?: string;
  readonly recordedAt: string;
  readonly data: unknown;
}

export interface RecordFindingRequest {
  readonly kind: FindingKind;
  readonly subject: string;
  readonly inputHash?: string;
  readonly data: unknown;
}

function isFindingKind(value: string): value is FindingKind {
  return (findingKinds as readonly string[]).includes(value);
}

function optionalText(value: SqlValue | undefined): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toFinding(row: SqlRow): Finding | undefined {
  const kind: string = String(row.kind);
  if (!isFindingKind(kind)) {
    return undefined;
  }

  const inputHash: string | undefined = optionalText(row.input_hash);

  return {
    kind,
    subject: String(row.subject),
    ...(inputHash === undefined ? {} : { inputHash }),
    recordedAt: String(row.recorded_at),
    data: JSON.parse(String(row.data)),
  };
}

export class FindingStore {
  public constructor(
    private readonly database: CacheDatabase,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  public record(request: RecordFindingRequest): void {
    this.database.run(
      'INSERT OR REPLACE INTO findings (kind, subject, input_hash, recorded_at, data) VALUES (?, ?, ?, ?, ?)',
      [
        request.kind,
        request.subject,
        request.inputHash ?? null,
        this.now().toISOString(),
        JSON.stringify(request.data),
      ],
    );
  }

  public find(kind: FindingKind, subject: string): Finding | undefined {
    const row: SqlRow | undefined = this.database.first(
      'SELECT * FROM findings WHERE kind = ? AND subject = ?',
      [kind, subject],
    );

    return row === undefined ? undefined : toFinding(row);
  }

  public findCurrent(kind: FindingKind, subject: string, inputHash: string): Finding | undefined {
    const finding: Finding | undefined = this.find(kind, subject);
    return finding?.inputHash === inputHash ? finding : undefined;
  }

  public list(kind: FindingKind): readonly Finding[] {
    return this.database
      .all('SELECT * FROM findings WHERE kind = ? ORDER BY subject', [kind])
      .flatMap((row): Finding[] => {
        const finding: Finding | undefined = toFinding(row);
        return finding === undefined ? [] : [finding];
      });
  }

  public remove(kind: FindingKind, subject: string): void {
    this.database.run('DELETE FROM findings WHERE kind = ? AND subject = ?', [kind, subject]);
  }
}

import {
  computeUsageSummaryFromEntries,
  parseUsageLedgerEntry,
  serializeUsageLedgerEntry,
  type UsageLedgerEntry,
  type UsageSummaryByEntity,
} from '@storyboard/story-model';

import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';

export class UsageStore {
  public constructor(private readonly database: CacheDatabase) {}

  public append(entry: UsageLedgerEntry): boolean {
    const isRecorded: boolean =
      this.database.first('SELECT id FROM usage WHERE id = ?', [entry.id]) !== undefined;
    if (isRecorded) {
      return false;
    }

    this.database.run(
      'INSERT INTO usage (id, recorded_at, task, provider, model, data) VALUES (?, ?, ?, ?, ?, ?)',
      [
        entry.id,
        entry.recordedAt,
        entry.taskName,
        entry.providerId,
        entry.model ?? '',
        serializeUsageLedgerEntry(entry),
      ],
    );

    return true;
  }

  public list(): readonly UsageLedgerEntry[] {
    return this.database
      .all('SELECT data FROM usage ORDER BY recorded_at, id')
      .flatMap((row): UsageLedgerEntry[] => {
        const entry: UsageLedgerEntry | undefined = parseUsageLedgerEntry(String(row.data));
        return entry === undefined ? [] : [entry];
      });
  }

  public summarize(): UsageSummaryByEntity {
    return computeUsageSummaryFromEntries(this.list());
  }
}

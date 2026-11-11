import {
  parseNovelRunState,
  serializeNovelRunState,
  type NovelRunState,
} from '@storyboard/story-model';

import type { SqlRow } from '#engine/ports/sqlDatabase';
import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';

export type RunKind = 'novel';

const novelRunKind: RunKind = 'novel';

export class RunStore {
  public constructor(private readonly database: CacheDatabase) {}

  public saveNovelRun(state: NovelRunState): void {
    this.database.run(
      `INSERT OR REPLACE INTO runs (id, kind, status, started_at, updated_at, data) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        state.runId,
        novelRunKind,
        state.status,
        state.startedAt,
        state.updatedAt,
        serializeNovelRunState(state),
      ],
    );
  }

  public findLatestNovelRun(): NovelRunState | undefined {
    const row: SqlRow | undefined = this.database.first(
      'SELECT data FROM runs WHERE kind = ? ORDER BY updated_at DESC LIMIT 1',
      [novelRunKind],
    );

    return row === undefined ? undefined : parseNovelRunState(String(row.data));
  }

  public removeNovelRun(runId: string): void {
    this.database.run('DELETE FROM runs WHERE id = ? AND kind = ?', [runId, novelRunKind]);
  }
}

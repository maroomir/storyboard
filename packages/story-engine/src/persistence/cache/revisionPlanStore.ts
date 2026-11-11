import { randomUUID } from 'node:crypto';

import {
  parseRevisionPlan,
  serializeRevisionPlan,
  type RevisionPlan,
} from '@storyboard/story-model';

import type { SqlRow } from '#engine/ports/sqlDatabase';
import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';

export interface StoredRevisionPlan {
  readonly id: string;
  readonly createdAt: string;
  readonly plan: RevisionPlan;
}

export class RevisionPlanStore {
  public constructor(
    private readonly database: CacheDatabase,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  public save(plan: RevisionPlan): StoredRevisionPlan {
    const stored: StoredRevisionPlan = {
      id: randomUUID(),
      createdAt: this.now().toISOString(),
      plan,
    };
    this.database.run('INSERT INTO revision_plans (id, created_at, data) VALUES (?, ?, ?)', [
      stored.id,
      stored.createdAt,
      serializeRevisionPlan(plan),
    ]);

    return stored;
  }

  public findLatest(): StoredRevisionPlan | undefined {
    const row: SqlRow | undefined = this.database.first(
      'SELECT * FROM revision_plans ORDER BY created_at DESC, rowid DESC LIMIT 1',
    );

    return row === undefined
      ? undefined
      : {
          id: String(row.id),
          createdAt: String(row.created_at),
          plan: parseRevisionPlan(String(row.data)),
        };
  }
}

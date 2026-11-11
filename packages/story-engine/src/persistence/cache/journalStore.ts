import { randomUUID } from 'node:crypto';

import type { SceneRenameStep } from '@storyboard/story-model';
import { z } from 'zod';

import type { SqlRow } from '#engine/ports/sqlDatabase';
import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';

export type JournalKind = 'scene-rename';

export interface SceneRenameJournalData {
  readonly steps: readonly SceneRenameStep[];
}

export interface SceneRenameJournal {
  readonly id: string;
  readonly createdAt: string;
  readonly completedSteps: number;
  readonly steps: readonly SceneRenameStep[];
}

const sceneRenameJournalKind: JournalKind = 'scene-rename';

const sceneRenameStepSchema: z.ZodType<SceneRenameStep> = z.object({
  sceneId: z.string().min(1),
  target: z.enum(['bundle', 'draft']),
  from: z.string().min(1),
  to: z.string().min(1),
});

const sceneRenameJournalDataSchema: z.ZodType<SceneRenameJournalData> = z.object({
  steps: z.array(sceneRenameStepSchema).readonly(),
});

function toSceneRenameJournal(row: SqlRow): SceneRenameJournal | undefined {
  const parsed: z.ZodSafeParseResult<SceneRenameJournalData> =
    sceneRenameJournalDataSchema.safeParse(JSON.parse(String(row.data)));

  return parsed.success
    ? {
        id: String(row.id),
        createdAt: String(row.created_at),
        completedSteps: Number(row.completed_steps),
        steps: parsed.data.steps,
      }
    : undefined;
}

export class JournalStore {
  public constructor(
    private readonly database: CacheDatabase,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  public beginSceneRename(steps: readonly SceneRenameStep[]): SceneRenameJournal {
    const journal: SceneRenameJournal = {
      id: randomUUID(),
      createdAt: this.now().toISOString(),
      completedSteps: 0,
      steps,
    };
    this.database.run(
      'INSERT INTO journal (id, kind, created_at, completed_steps, data) VALUES (?, ?, ?, ?, ?)',
      [
        journal.id,
        sceneRenameJournalKind,
        journal.createdAt,
        journal.completedSteps,
        JSON.stringify(sceneRenameJournalDataSchema.parse({ steps })),
      ],
    );

    return journal;
  }

  public recordCompletedSteps(journalId: string, completedSteps: number): void {
    this.database.run('UPDATE journal SET completed_steps = ? WHERE id = ?', [
      completedSteps,
      journalId,
    ]);
  }

  public finish(journalId: string): void {
    this.database.run('DELETE FROM journal WHERE id = ?', [journalId]);
  }

  public findUnfinishedSceneRename(): SceneRenameJournal | undefined {
    const row: SqlRow | undefined = this.database.first(
      'SELECT * FROM journal WHERE kind = ? ORDER BY created_at LIMIT 1',
      [sceneRenameJournalKind],
    );

    return row === undefined ? undefined : toSceneRenameJournal(row);
  }
}

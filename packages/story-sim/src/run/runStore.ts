import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { TokenTotals } from '#sim/run/usageLedger';
import type { SceneMetrics } from '#sim/score/deterministic';

export interface RunRecord {
  readonly runId: string;
  readonly genre: string;
  readonly pointLabel: string;
  readonly repeat: number;
  readonly engineCommit: string;
  readonly engineVersion?: string;
  readonly trackCommit: string;
  readonly trackDirty: boolean;
  readonly knobs: Readonly<Record<string, number>>;
  readonly generation: {
    readonly providerId: string;
    readonly model: string;
    readonly promptVariant?: string;
    readonly think?: boolean;
  };
  readonly judge?: { readonly providerId: string; readonly model: string };
  readonly scenes: readonly SceneMetrics[];
  readonly tokens: TokenTotals;
  readonly judgeTokens?: TokenTotals;
  readonly rejudgedFrom?: string;
  readonly auc?: number;
  readonly recalled?: number;
  readonly recallTotal?: number;
  readonly contradicted?: number;
  readonly discarded?: boolean;
  readonly discardReasons?: readonly string[];
  readonly floorGate?: {
    readonly passed: boolean;
    readonly failures: readonly string[];
    readonly abstained: readonly string[];
  };
  readonly panel?: {
    readonly byReader: Readonly<Record<string, number>>;
    readonly curves: Readonly<Record<string, readonly number[]>>;
    readonly dropOffScene: Readonly<Record<string, string | undefined>>;
    readonly engagement?: number;
    readonly engagementByReader?: Readonly<Record<string, number>>;
  };
  readonly genreNotes?: readonly {
    readonly sceneStem: string;
    readonly engagement: number;
    readonly continueReading: boolean;
    readonly reason: string;
    readonly quote: string;
  }[];
  readonly genreProblems?: readonly string[];
  readonly critic?: {
    readonly groundedTotal: number;
    readonly opinionTotal: number;
    readonly gatePassed: boolean;
    readonly scores: readonly {
      readonly criterion: string;
      readonly score: number;
      readonly reason: string;
      readonly quote?: string;
      readonly opinion: boolean;
      readonly ungrounded?: boolean;
    }[];
    readonly gateReason: string;
    readonly problems: readonly string[];
  };
  readonly axisVerdicts?: readonly {
    readonly sceneStem: string;
    readonly axis: string;
    readonly verdict: string;
    readonly discarded: boolean;
  }[];
  readonly draftsDir?: string;
  readonly startedAt: string;
  readonly wallClockMs: number;
}

interface RunRecordPayload {
  runId: string;
  genre: string;
  pointLabel: string;
  repeat: number;
  engineCommit: string;
  trackCommit: string;
  trackDirty: boolean;
  knobs: Record<string, number>;
  startedAt: string;
  wallClockMs: number;
  [key: string]: unknown;
}

const runRecordSchema: z.ZodType<RunRecordPayload> = z
  .object({
    runId: z.string().min(1),
    genre: z.string().min(1),
    pointLabel: z.string().min(1),
    repeat: z.number().int().positive(),
    engineCommit: z.string(),
    trackCommit: z.string(),
    trackDirty: z.boolean(),
    knobs: z.record(z.string(), z.number()),
    startedAt: z.string(),
    wallClockMs: z.number(),
  })
  .passthrough();

export function runKey(genre: string, pointLabel: string, repeat: number): string {
  return `${genre}/${pointLabel}#${repeat}`;
}

export async function appendRun(filePath: string, record: RunRecord): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function readRuns(filePath: string): Promise<readonly RunRecord[]> {
  let raw: string;

  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  const records: RunRecord[] = [];

  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const parsed: z.ZodSafeParseResult<RunRecordPayload> = runRecordSchema.safeParse(JSON.parse(line));
      if (parsed.success) {
        records.push(parsed.data as unknown as RunRecord);
      }
    } catch {
      continue;
    }
  }

  return records;
}

export async function completedKeys(
  filePath: string,
  scope: {
    readonly engineCommit: string;
    readonly trackCommit: string;
    readonly generation?: RunRecord['generation'];
    readonly judge?: RunRecord['judge'];
  },
): Promise<ReadonlySet<string>> {
  const runs: readonly RunRecord[] = await readRuns(filePath);

  return new Set(
    runs
      .filter(
        (run) =>
          run.engineCommit === scope.engineCommit &&
          run.trackCommit === scope.trackCommit &&
          run.trackDirty === false &&
          (scope.generation === undefined || sameGeneration(run.generation, scope.generation)) &&
          (scope.judge === undefined || describeJudgeOf(run.judge) === describeJudgeOf(scope.judge)),
      )
      .map((run) => runKey(run.genre, run.pointLabel, run.repeat)),
  );
}

function describeJudgeOf(judge: RunRecord['judge']): string {
  return judge === undefined ? '' : `${judge.providerId}:${judge.model}`;
}

function sameGeneration(left: RunRecord['generation'], right: RunRecord['generation']): boolean {
  return (
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.promptVariant === right.promptVariant &&
    left.think === right.think
  );
}

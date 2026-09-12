import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { TokenTotals } from '#sim/run/usageLedger';
import type { SceneMetrics } from '#sim/score/deterministic';

// NOTE: 한 지점이 끝날 때마다 한 줄씩 덧붙인다. 통째로 다시 쓰면 며칠짜리 스윕이 중간에 죽었을 때
// 앞서 몇 시간 돌린 결과까지 함께 사라진다. 구독 한도나 메모리 부족으로 죽는 일은 실제로 있었다.

export interface RunRecord {
  readonly runId: string;
  // 지점과 회차. 이어서 돌릴 때 이미 끝난 것을 건너뛰는 열쇠다.
  readonly pointLabel: string;
  readonly repeat: number;
  // 무엇을 쟀는지 못박는 두 해시. 하나라도 다르면 비교하지 않는다.
  readonly engineCommit: string;
  readonly trackCommit: string;
  readonly trackDirty: boolean;
  readonly knobs: Readonly<Record<string, number>>;
  readonly generation: { readonly providerId: string; readonly model: string };
  readonly scenes: readonly SceneMetrics[];
  readonly tokens: TokenTotals;
  readonly auc?: number;
  readonly recalled?: number;
  readonly recallTotal?: number;
  readonly contradicted?: number;
  readonly discarded?: boolean;
  readonly startedAt: string;
  readonly wallClockMs: number;
}

const runRecordSchema = z.object({
  runId: z.string().min(1),
  pointLabel: z.string().min(1),
  repeat: z.number().int().positive(),
  engineCommit: z.string(),
  trackCommit: z.string(),
  trackDirty: z.boolean(),
  knobs: z.record(z.string(), z.number()),
  startedAt: z.string(),
  wallClockMs: z.number(),
}).passthrough();

export function runKey(pointLabel: string, repeat: number): string {
  return `${pointLabel}#${repeat}`;
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

    // 죽는 순간 반쯤 쓰인 줄이 남을 수 있다. 읽을 수 없는 줄은 버리고 나머지를 살린다.
    try {
      const parsed = runRecordSchema.safeParse(JSON.parse(line));
      if (parsed.success) {
        records.push(parsed.data as unknown as RunRecord);
      }
    } catch {
      continue;
    }
  }

  return records;
}

// 이어서 돌릴 때 건너뛸 것들. 엔진이나 트랙이 바뀐 뒤의 기록은 이어 쓸 수 없으므로 세지 않는다.
export async function completedKeys(
  filePath: string,
  scope: { readonly engineCommit: string; readonly trackCommit: string },
): Promise<ReadonlySet<string>> {
  const runs = await readRuns(filePath);

  return new Set(
    runs
      .filter(
        (run) =>
          run.engineCommit === scope.engineCommit &&
          run.trackCommit === scope.trackCommit &&
          run.trackDirty === false,
      )
      .map((run) => runKey(run.pointLabel, run.repeat)),
  );
}

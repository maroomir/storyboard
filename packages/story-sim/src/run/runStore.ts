import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import type { TokenTotals } from '#sim/run/usageLedger';
import type { SceneMetrics } from '#sim/score/deterministic';

// NOTE: 한 지점이 끝날 때마다 한 줄씩 덧붙인다. 통째로 다시 쓰면 며칠짜리 스윕이 중간에 죽었을 때
// 앞서 몇 시간 돌린 결과까지 함께 사라진다. 구독 한도나 메모리 부족으로 죽는 일은 실제로 있었다.

export interface RunRecord {
  readonly runId: string;
  // 트랙 단위(장르)·지점·회차. 이어서 돌릴 때 이미 끝난 것을 건너뛰는 열쇠다. 장르가 빠지면
  // 한 결과 파일에 두 장르를 쌓을 때 둘째 장르가 «이미 끝남» 으로 읽힌다.
  readonly genre: string;
  readonly pointLabel: string;
  readonly repeat: number;
  // 무엇을 쟀는지 못박는 두 해시. 하나라도 다르면 비교하지 않는다.
  readonly engineCommit: string;
  // 엔진의 패키지 버전. engineCommit 이 git 해시가 된 뒤에도 사람이 읽을 이름은 남긴다.
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
  readonly scenes: readonly SceneMetrics[];
  readonly tokens: TokenTotals;
  readonly auc?: number;
  readonly recalled?: number;
  readonly recallTotal?: number;
  readonly contradicted?: number;
  readonly discarded?: boolean;
  // 회차를 버린 이유. AUC 가 없는 줄을 되짚을 때 본다.
  readonly discardReasons?: readonly string[];
  // 하한선 관문 결과. 실패해도 회차는 남지만, 그 AUC 는 심판이 훼손본을 못 가려낸 채 낸 값이다.
  readonly floorGate?: {
    readonly passed: boolean;
    readonly failures: readonly string[];
    readonly abstained: readonly string[];
  };
  // 공통 독자 4인의 곡선. AUC 하나로는 «넷 다 미지근» 과 «셋은 좋고 하나가 일찍 덮음» 이 안 갈린다.
  readonly panel?: {
    readonly byReader: Readonly<Record<string, number>>;
    readonly curves: Readonly<Record<string, readonly number[]>>;
    readonly dropOffScene: Readonly<Record<string, string | undefined>>;
  };
  // 장르 독자의 말. AUC 에 안 들어가지만 사람이 읽을 값어치가 있다.
  readonly genreNotes?: readonly {
    readonly sceneStem: string;
    readonly engagement: number;
    readonly continueReading: boolean;
    readonly reason: string;
    readonly quote: string;
  }[];
  readonly genreProblems?: readonly string[];
  // 축 트랙만 채운다. 진단표이지 성능이 아니므로 파레토에 들어가지 않는다.
  readonly axisVerdicts?: readonly {
    readonly sceneStem: string;
    readonly axis: string;
    readonly verdict: string;
    readonly discarded: boolean;
  }[];
  // 씬 원고를 남긴 곳. 결과 파일이 있는 디렉터리 기준의 상대 경로다. 폐기된 회차를 되짚을 때 본다.
  readonly draftsDir?: string;
  readonly startedAt: string;
  readonly wallClockMs: number;
}

const runRecordSchema = z
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
      .map((run) => runKey(run.genre, run.pointLabel, run.repeat)),
  );
}

import type { RunRecord } from '#sim/run/runStore';

// NOTE: 심판을 바꿀 때 생성을 다시 돌릴 이유가 없다. 원고는 results/drafts/ 에 그대로 있으니 판정만
// 다시 받는다. 새 기록은 생성 쪽 칸(손잡이·씬·토큰·원고 자리)을 원본에서 그대로 물려받고, 판정 쪽
// 칸만 새 심판의 것이며, rejudgedFrom 으로 원본을 가리킨다. 같은 원본을 같은 심판으로 두 번 채점하지
// 않는다.

export interface RejudgeSource {
  readonly run: RunRecord;
  readonly draftsDir: string;
}

export function rejudgeSources(
  runs: readonly RunRecord[],
  input: {
    readonly pointLabel: string;
    readonly enginePrefix?: string;
    readonly judge: NonNullable<RunRecord['judge']>;
  },
): readonly RejudgeSource[] {
  const judgeKey = `${input.judge.providerId}:${input.judge.model}`;
  const alreadyDone = new Set(
    runs
      .filter((run) => run.rejudgedFrom !== undefined && run.judge !== undefined)
      .filter((run) => `${run.judge?.providerId}:${run.judge?.model}` === judgeKey)
      .map((run) => run.rejudgedFrom as string),
  );

  return runs
    .filter((run) => run.pointLabel === input.pointLabel)
    .filter((run) => run.rejudgedFrom === undefined && run.draftsDir !== undefined)
    .filter((run) => input.enginePrefix === undefined || run.engineCommit.startsWith(input.enginePrefix))
    .filter((run) => !alreadyDone.has(run.runId))
    .map((run) => ({ run, draftsDir: run.draftsDir as string }));
}

export function rejudgedRecord(
  source: RunRecord,
  input: {
    readonly engineCommit: string;
    readonly engineVersion?: string;
    readonly judge: NonNullable<RunRecord['judge']>;
    readonly verdict: Partial<RunRecord>;
    readonly startedAt: string;
  },
): RunRecord {
  const {
    auc: _auc,
    recalled: _recalled,
    recallTotal: _recallTotal,
    contradicted: _contradicted,
    discarded: _discarded,
    discardReasons: _discardReasons,
    floorGate: _floorGate,
    panel: _panel,
    genreNotes: _genreNotes,
    genreProblems: _genreProblems,
    critic: _critic,
    judgeTokens: _judgeTokens,
    ...generationSide
  } = source;

  return {
    ...generationSide,
    runId: `${source.runId}~${input.judge.providerId}:${input.judge.model}`,
    engineCommit: input.engineCommit,
    ...(input.engineVersion === undefined ? {} : { engineVersion: input.engineVersion }),
    judge: input.judge,
    rejudgedFrom: source.runId,
    startedAt: input.startedAt,
    ...input.verdict,
  };
}

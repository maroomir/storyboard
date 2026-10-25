import type { RunRecord } from '#sim/run/runStore';

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
    readonly engineCommit?: string;
  },
): readonly RejudgeSource[] {
  const judgeKey: string = `${input.judge.providerId}:${input.judge.model}`;
  const alreadyDone: Set<string> = new Set(
    runs
      .filter((run) => run.rejudgedFrom !== undefined && run.judge !== undefined)
      .filter((run) => `${run.judge?.providerId}:${run.judge?.model}` === judgeKey)
      .filter((run) => input.engineCommit === undefined || run.engineCommit === input.engineCommit)
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

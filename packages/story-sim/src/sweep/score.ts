import type { RunRecord } from '#sim/run/runStore';
import { median, type CostAxis, type ScoredPoint } from '#sim/sweep/pareto';

export interface PointScore extends ScoredPoint {
  readonly pointLabel: string;
  readonly engineCommit: string;
  readonly trackCommit: string;
  readonly generation: string;
  readonly judge: string;
  readonly judgeCostUsd?: number;
  readonly engagement?: number;
  readonly runs: number;
  readonly judged: number;
  readonly gatePassed: number;
  readonly critic?: {
    readonly grounded: number;
    readonly opinion: number;
    readonly gatePassed: number;
    readonly runs: number;
  };
}

function criticSummary(judged: readonly RunRecord[]): { readonly critic?: PointScore['critic'] } {
  const scored: RunRecord[] = judged.filter((run) => run.critic !== undefined);

  if (scored.length === 0) {
    return {};
  }

  return {
    critic: {
      grounded: median(scored.map((run) => run.critic?.groundedTotal ?? 0)),
      opinion: median(scored.map((run) => run.critic?.opinionTotal ?? 0)),
      gatePassed: scored.filter((run) => run.critic?.gatePassed === true).length,
      runs: scored.length,
    },
  };
}

export function describeJudge(run: RunRecord): string {
  return run.judge === undefined ? '' : `${run.judge.providerId}:${run.judge.model}`;
}

function engagementOf(judged: readonly RunRecord[]): { readonly engagement?: number } {
  const values: number[] = judged
    .map((run) => run.panel?.engagement)
    .filter((value): value is number => value !== undefined);

  return values.length === 0 ? {} : { engagement: median(values) };
}

function judgeCost(judged: readonly RunRecord[]): { readonly judgeCostUsd?: number } {
  const costs: number[] = judged
    .map((run) => run.judgeTokens?.costUsd)
    .filter((cost): cost is number => cost !== undefined);

  return costs.length === 0 ? {} : { judgeCostUsd: median(costs) };
}

export function describeGeneration(run: RunRecord): string {
  const { providerId, model, promptVariant, think } = run.generation;
  const suffix: string = [
    promptVariant,
    think === undefined ? undefined : think ? 'think' : 'nothink',
  ]
    .filter((part): part is string => part !== undefined)
    .join('/');

  return `${providerId}:${model}${suffix.length === 0 ? '' : `/${suffix}`}`;
}

export function isJudged(run: RunRecord): boolean {
  return run.discarded !== true && run.auc !== undefined;
}

export function costOfRun(run: RunRecord, axis: CostAxis): number {
  if (axis === 'usd') {
    return run.tokens.costUsd ?? 0;
  }

  return run.tokens.inputTokens + run.tokens.outputTokens;
}

export function scoreRuns(runs: readonly RunRecord[], axis: CostAxis): readonly PointScore[] {
  const groups: Map<string, RunRecord[]> = new Map<string, RunRecord[]>();

  for (const run of runs) {
    const key: string = [
      run.genre,
      run.pointLabel,
      run.engineCommit,
      run.trackCommit,
      describeGeneration(run),
      describeJudge(run),
    ].join('\u0000');
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  return [...groups.values()].map((group) => {
    const first: RunRecord = group[0] as RunRecord;
    const judged: RunRecord[] = group.filter(isJudged);

    return {
      label: `${first.genre}/${first.pointLabel}`,
      pointLabel: first.pointLabel,
      genre: first.genre,
      engineCommit: first.engineCommit,
      trackCommit: first.trackCommit,
      generation: describeGeneration(first),
      judge: describeJudge(first),
      ...judgeCost(judged),
      ...engagementOf(judged),
      runs: group.length,
      judged: judged.length,
      gatePassed: judged.filter((run) => run.floorGate?.passed === true).length,
      ...criticSummary(judged),
      auc: median(judged.map((run) => run.auc as number)),
      cost: median(group.map((run) => costOfRun(run, axis))),
      recalled: median(judged.map((run) => run.recalled ?? 0)),
      contradicted: median(judged.map((run) => run.contradicted ?? 0)),
    };
  });
}

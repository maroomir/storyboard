import type { RunRecord } from '#sim/run/runStore';
import { median, type CostAxis, type ScoredPoint } from '#sim/sweep/pareto';

// NOTE: 폐기된 회차는 AUC 가 없다. 그것을 0 으로 쳐서 중앙값에 넣으면 셋 중 둘이 폐기된 지점이
// «AUC 0» 으로 읽힌다. 실측에서 그 일이 있었다 — 유효 회차 둘이 0.12 를 냈는데 리포트는 0.000 을
// 찍었다. 품질 축은 심판이 끝까지 본 회차만으로 내고, 몇 회 중 몇 회였는지를 함께 밝힌다.
// 비용 축은 폐기 회차도 넣는다. 생성은 실제로 돌았고 토큰은 실제로 썼다.
//
// 엔진이나 트랙이 다른 기록은 다른 것을 잰 값이라 같은 지점 이름이라도 따로 센다.

export interface PointScore extends ScoredPoint {
  readonly pointLabel: string;
  readonly engineCommit: string;
  readonly trackCommit: string;
  // 무엇으로 썼는지. 같은 지점이라도 생성 모델·프롬프트 변형이 다르면 다른 것을 잰 값이다.
  readonly generation: string;
  // 누가 채점했는지. 심판이 다르면 AUC 는 다른 눈금이다. 심판 없는 실행은 빈 문자열.
  readonly judge: string;
  // 유효 회차의 심판 금액 중앙값. 로컬 심판은 0, 금액을 모르면 없다.
  readonly judgeCostUsd?: number;
  readonly runs: number;
  // 심판이 끝까지 보고 AUC 를 낸 회차 수. 0 이면 품질 축의 값은 뜻이 없다.
  readonly judged: number;
  // 유효 회차 중 하한선 관문을 지난 수. judged 보다 훨씬 작으면 그 AUC 는 심판을 못 믿은 채 낸 값이다.
  readonly gatePassed: number;
  // 비평가 점수의 중앙값(인용 기준 합 /20, 의견 합 /10)과 비평 관문을 지난 회차 수. 비평가를 안 부른 지점은 없다.
  readonly critic?: {
    readonly grounded: number;
    readonly opinion: number;
    readonly gatePassed: number;
    readonly runs: number;
  };
}

function criticSummary(judged: readonly RunRecord[]): { readonly critic?: PointScore['critic'] } {
  const scored = judged.filter((run) => run.critic !== undefined);

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

function judgeCost(judged: readonly RunRecord[]): { readonly judgeCostUsd?: number } {
  const costs = judged
    .map((run) => run.judgeTokens?.costUsd)
    .filter((cost): cost is number => cost !== undefined);

  return costs.length === 0 ? {} : { judgeCostUsd: median(costs) };
}

export function describeGeneration(run: RunRecord): string {
  const { providerId, model, promptVariant, think } = run.generation;
  const suffix = [promptVariant, think === undefined ? undefined : think ? 'think' : 'nothink']
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
  const groups = new Map<string, RunRecord[]>();

  for (const run of runs) {
    const key = [
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
    const first = group[0] as RunRecord;
    const judged = group.filter(isJudged);

    return {
      label: `${first.genre}/${first.pointLabel}`,
      pointLabel: first.pointLabel,
      genre: first.genre,
      engineCommit: first.engineCommit,
      trackCommit: first.trackCommit,
      generation: describeGeneration(first),
      judge: describeJudge(first),
      ...judgeCost(judged),
      runs: group.length,
      judged: judged.length,
      gatePassed: judged.filter((run) => run.floorGate?.passed === true).length,
      ...criticSummary(judged),
      // 씨앗이 없어 회차마다 흔들리므로 최고값이 아니라 중앙값을 쓴다.
      auc: median(judged.map((run) => run.auc as number)),
      cost: median(group.map((run) => costOfRun(run, axis))),
      recalled: median(judged.map((run) => run.recalled ?? 0)),
      contradicted: median(judged.map((run) => run.contradicted ?? 0)),
    };
  });
}

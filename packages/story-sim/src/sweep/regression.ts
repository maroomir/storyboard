import type { RunRecord } from '#sim/run/runStore';
import { median, noiseFloor } from '#sim/sweep/pareto';
import { describeGeneration, describeJudge, isJudged } from '#sim/sweep/score';

// NOTE: 릴리즈마다 같은 지점을 돌려 앞 엔진과 견주는 회귀 검사다. 손잡이 실험이 아니라 «엔진이 바뀌었는데
// 독자·회수가 잡음 밖으로 움직였나» 만 본다. 잡음 폭은 씨앗이 없는 실행의 회차 간 최대·최소 차이이며,
// 어느 쪽 폭이든 넘어야 «움직였다» 고 말한다. 폭이 무한(회차 1)이면 판정하지 않는다.

export interface RegressionRow {
  readonly genre: string;
  readonly pointLabel: string;
  readonly generation: string;
  readonly judge: string;
  readonly latestEngine: string;
  readonly previousEngine: string;
  readonly latestRuns: number;
  readonly previousRuns: number;
  readonly aucDelta: number;
  readonly recallDelta: number;
  readonly noise: number;
  // 몰입도와 비평 근거 점수의 중앙값 차이. 양쪽 엔진 모두에 기록이 있을 때만 있다(옛 기록엔 없다).
  readonly engagementDelta?: number;
  readonly engagementNoise?: number;
  readonly criticDelta?: number;
  readonly verdict: 'outside-noise' | 'within-noise' | 'undecidable';
}

function definedMedianDelta(
  latest: readonly RunRecord[],
  previous: readonly RunRecord[],
  pick: (run: RunRecord) => number | undefined,
): { readonly delta: number; readonly noise: number } | undefined {
  const values = (list: readonly RunRecord[]): number[] =>
    list.map(pick).filter((value): value is number => value !== undefined);
  const latestValues = values(latest);
  const previousValues = values(previous);
  if (latestValues.length === 0 || previousValues.length === 0) {
    return undefined;
  }

  return {
    delta: median(latestValues) - median(previousValues),
    noise: Math.max(noiseFloor(latestValues), noiseFloor(previousValues)),
  };
}

function latestStart(runs: readonly RunRecord[]): string {
  return runs.map((run) => run.startedAt).sort().at(-1) ?? '';
}

export function regressionRows(runs: readonly RunRecord[]): readonly RegressionRow[] {
  const judged = runs.filter(isJudged);
  const groups = new Map<string, RunRecord[]>();

  for (const run of judged) {
    const key = [run.genre, run.pointLabel, describeGeneration(run), describeJudge(run)].join('|');
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  const rows: RegressionRow[] = [];

  for (const group of groups.values()) {
    const byEngine = new Map<string, RunRecord[]>();
    for (const run of group) {
      byEngine.set(run.engineCommit, [...(byEngine.get(run.engineCommit) ?? []), run]);
    }

    if (byEngine.size < 2) {
      continue;
    }

    const ordered = [...byEngine.entries()].sort((left, right) =>
      latestStart(left[1]).localeCompare(latestStart(right[1])),
    );
    const [previousEngine, previous] = ordered.at(-2) as [string, RunRecord[]];
    const [latestEngine, latest] = ordered.at(-1) as [string, RunRecord[]];
    const first = latest[0] as RunRecord;
    const aucOf = (list: readonly RunRecord[]): number[] => list.map((run) => run.auc as number);
    const recallOf = (list: readonly RunRecord[]): number[] => list.map((run) => run.recalled ?? 0);
    const noise = Math.max(noiseFloor(aucOf(latest)), noiseFloor(aucOf(previous)));
    const aucDelta = median(aucOf(latest)) - median(aucOf(previous));
    const engagement = definedMedianDelta(latest, previous, (run) => run.panel?.engagement);
    const critic = definedMedianDelta(latest, previous, (run) => run.critic?.groundedTotal);
    // 짠 심판은 AUC 가 0 근처에 뭉치므로 몰입도가 자기 잡음 폭을 넘어도 «움직였다» 고 본다.
    const moved =
      Math.abs(aucDelta) > noise ||
      (engagement !== undefined && Math.abs(engagement.delta) > engagement.noise);

    rows.push({
      genre: first.genre,
      pointLabel: first.pointLabel,
      generation: describeGeneration(first),
      judge: describeJudge(first),
      latestEngine,
      previousEngine,
      latestRuns: latest.length,
      previousRuns: previous.length,
      aucDelta,
      recallDelta: median(recallOf(latest)) - median(recallOf(previous)),
      noise,
      ...(engagement === undefined
        ? {}
        : { engagementDelta: engagement.delta, engagementNoise: engagement.noise }),
      ...(critic === undefined ? {} : { criticDelta: critic.delta }),
      verdict: !Number.isFinite(noise) ? 'undecidable' : moved ? 'outside-noise' : 'within-noise',
    });
  }

  return rows;
}

export function describeRegression(row: RegressionRow): string {
  const sign = (value: number, digits: number): string =>
    `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
  const verdict =
    row.verdict === 'undecidable'
      ? '판정 불가 (회차 1)'
      : row.verdict === 'outside-noise'
        ? '잡음 밖, 확인 필요'
        : '잡음 안';
  const noise = Number.isFinite(row.noise) ? row.noise.toFixed(3) : '무한';

  const judge = row.judge.length === 0 ? '' : ` 심판 ${row.judge}`;
  const engagement =
    row.engagementDelta === undefined || row.engagementNoise === undefined
      ? ''
      : ` · 몰입 ${sign(row.engagementDelta, 3)} (폭 ${Number.isFinite(row.engagementNoise) ? row.engagementNoise.toFixed(3) : '무한'})`;
  const critic = row.criticDelta === undefined ? '' : ` · 비평 ${sign(row.criticDelta, 0)}`;

  return `${row.pointLabel} [${row.generation}${judge}] ${row.previousEngine.slice(0, 7)}(${row.previousRuns}회) 대비 ${row.latestEngine.slice(0, 7)}(${row.latestRuns}회): AUC ${sign(row.aucDelta, 3)} · 회수 ${sign(row.recallDelta, 1)}${engagement}${critic} · 잡음 폭 ${noise} · ${verdict}`;
}

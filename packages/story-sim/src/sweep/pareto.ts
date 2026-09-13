export interface ScoredPoint {
  readonly label: string;
  // 어느 시험체에서 나온 값인지. 장르가 다르면 서로 다른 것을 잰 값이라 함께 줄 세우지 않는다.
  readonly genre: string;
  // 클수록 좋다.
  readonly auc: number;
  // 작을수록 좋다. 비용 축의 실제 값이며, 아래 costAxis 가 그것이 무엇인지 말한다.
  readonly cost: number;
  readonly recalled: number;
  readonly contradicted: number;
}

// NOTE: 로컬 모델은 요금이 0이라 금액으로 재면 모든 지점이 같아진다. 그때 실제로 아까운 것은
// 돈이 아니라 시간과 토큰이므로, 무엇을 x축으로 삼았는지 리포트가 늘 밝힌다.
export type CostAxis = 'usd' | 'tokens' | 'seconds';

export function chooseCostAxis(totalUsd: number | undefined): CostAxis {
  return totalUsd === undefined || totalUsd === 0 ? 'tokens' : 'usd';
}

export const costAxisLabels: Readonly<Record<CostAxis, string>> = {
  usd: '비용(달러)',
  tokens: '토큰',
  seconds: '시간(초)',
};

// NOTE: 회수율은 파레토 축이 아니다. 거래할 수 있는 값이 아니라 정확성 관문이다 — 기준선보다
// 사실을 더 많이 놓치는 지점은 AUC 가 아무리 높아도 채택할 수 없다.
export function excludeBelowBaselineRecall(
  points: readonly ScoredPoint[],
  baseline: ScoredPoint,
): readonly ScoredPoint[] {
  return points.filter((point) => point.recalled >= baseline.recalled);
}

function dominates(left: ScoredPoint, right: ScoredPoint): boolean {
  const noWorse = left.auc >= right.auc && left.cost <= right.cost;
  const strictlyBetter = left.auc > right.auc || left.cost < right.cost;

  return noWorse && strictlyBetter;
}

// 품질이 더 높으면서 비용이 더 적은 지점이 없는 것들. 고를 값어치가 있는 후보만 남는다.
// NOTE: 경계는 시험체마다 따로 낸다. 스릴러 8씬과 무협 8씬은 다른 것을 잰 값이라, 한 평면에
// 올리면 «싼 장르» 가 «이긴 손잡이» 로 읽힌다.
export function paretoFrontier(points: readonly ScoredPoint[]): readonly ScoredPoint[] {
  const genres = [...new Set(points.map((point) => point.genre))];

  return genres
    .flatMap((genre) => {
      const inGenre = points.filter((point) => point.genre === genre);
      return inGenre.filter((candidate) => !inGenre.some((other) => dominates(other, candidate)));
    })
    .sort((left, right) => right.auc - left.auc);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

// 씨앗이 없어 같은 지점도 회차마다 흔들린다. 이 폭보다 작은 차이는 손잡이 효과라고 말할 수 없다.
export function noiseFloor(baselineRuns: readonly number[]): number {
  if (baselineRuns.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(...baselineRuns) - Math.min(...baselineRuns);
}

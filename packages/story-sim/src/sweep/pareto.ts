export interface ScoredPoint {
  readonly label: string;
  // 클수록 좋다.
  readonly auc: number;
  // 작을수록 좋다.
  readonly tokens: number;
  readonly recalled: number;
  readonly contradicted: number;
}

// NOTE: 회수율은 파레토 축이 아니다. 거래할 수 있는 값이 아니라 정확성 관문이다 — 기준선보다
// 사실을 더 많이 놓치는 지점은 AUC 가 아무리 높아도 채택할 수 없다.
export function excludeBelowBaselineRecall(
  points: readonly ScoredPoint[],
  baseline: ScoredPoint,
): readonly ScoredPoint[] {
  return points.filter((point) => point.recalled >= baseline.recalled);
}

function dominates(left: ScoredPoint, right: ScoredPoint): boolean {
  const noWorse = left.auc >= right.auc && left.tokens <= right.tokens;
  const strictlyBetter = left.auc > right.auc || left.tokens < right.tokens;

  return noWorse && strictlyBetter;
}

// 품질이 더 높으면서 토큰이 더 적은 지점이 없는 것들. 고를 값어치가 있는 후보만 남는다.
export function paretoFrontier(points: readonly ScoredPoint[]): readonly ScoredPoint[] {
  return points
    .filter((candidate) => !points.some((other) => dominates(other, candidate)))
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

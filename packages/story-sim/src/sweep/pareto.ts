export interface ScoredPoint {
  readonly label: string;
  readonly genre: string;
  readonly auc: number;
  readonly cost: number;
  readonly recalled: number;
  readonly contradicted: number;
}

export type CostAxis = 'usd' | 'tokens' | 'seconds';

export function chooseCostAxis(totalUsd: number | undefined): CostAxis {
  return totalUsd === undefined || totalUsd === 0 ? 'tokens' : 'usd';
}

export const costAxisLabels: Readonly<Record<CostAxis, string>> = {
  usd: '비용(달러)',
  tokens: '토큰',
  seconds: '시간(초)',
};

export function excludeBelowBaselineRecall(
  points: readonly ScoredPoint[],
  baseline: ScoredPoint,
): readonly ScoredPoint[] {
  return points.filter((point) => point.recalled >= baseline.recalled);
}

function dominates(left: ScoredPoint, right: ScoredPoint): boolean {
  const noWorse: boolean = left.auc >= right.auc && left.cost <= right.cost;
  const strictlyBetter: boolean = left.auc > right.auc || left.cost < right.cost;

  return noWorse && strictlyBetter;
}

export function paretoFrontier(points: readonly ScoredPoint[]): readonly ScoredPoint[] {
  const genres: string[] = [...new Set(points.map((point) => point.genre))];

  return genres
    .flatMap((genre) => {
      const inGenre: ScoredPoint[] = points.filter((point) => point.genre === genre);
      return inGenre.filter((candidate) => !inGenre.some((other) => dominates(other, candidate)));
    })
    .sort((left, right) => right.auc - left.auc);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted: number[] = [...values].sort((left, right) => left - right);
  const middle: number = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function noiseFloor(baselineRuns: readonly number[]): number {
  if (baselineRuns.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(...baselineRuns) - Math.min(...baselineRuns);
}

import { simDefaults } from '#sim/simDefaults';

export interface ReaderTurn {
  readonly sceneStem: string;
  readonly engagement: number;
  readonly continueReading: boolean;
  readonly reason: string;
  readonly quote: string;
}

export interface ReaderCurve {
  readonly readerId: string;
  readonly turns: readonly ReaderTurn[];
}

export function weightsOf(curve: ReaderCurve, sceneCount: number): readonly number[] {
  const scale: number = simDefaults.panel.engagementScaleMax;
  let stopped: boolean = false;

  return Array.from({ length: sceneCount }, (_, index) => {
    if (stopped) {
      return 0;
    }

    const turn: ReaderTurn | undefined = curve.turns[index];
    if (turn === undefined) {
      return 0;
    }

    if (!turn.continueReading) {
      stopped = true;
    }

    return Math.min(Math.max(turn.engagement, 0), scale) / scale;
  });
}

export function readerAuc(curve: ReaderCurve, sceneCount: number): number {
  if (sceneCount <= 0) {
    return 0;
  }

  const weights: readonly number[] = weightsOf(curve, sceneCount);
  return weights.reduce((total, weight) => total + weight, 0) / sceneCount;
}

export interface PanelAuc {
  readonly auc: number;
  readonly byReader: Readonly<Record<string, number>>;
  readonly curves: Readonly<Record<string, readonly number[]>>;
  readonly dropOffScene: Readonly<Record<string, string | undefined>>;
  readonly engagement: number;
  readonly engagementByReader: Readonly<Record<string, number>>;
}

export function readerEngagement(curve: ReaderCurve): number {
  const scale: number = simDefaults.panel.engagementScaleMax;
  const normalizedEngagement: number[] = curve.turns.map(
    (turn) => Math.min(Math.max(turn.engagement, 0), scale) / scale,
  );

  return normalizedEngagement.length === 0
    ? 0
    : normalizedEngagement.reduce((sum, value) => sum + value, 0) / normalizedEngagement.length;
}

export function panelAuc(curves: readonly ReaderCurve[], sceneCount: number): PanelAuc {
  const byReader: Record<string, number> = {};
  const weights: Record<string, readonly number[]> = {};
  const dropOffScene: Record<string, string | undefined> = {};
  const engagementByReader: Record<string, number> = {};

  for (const curve of curves) {
    byReader[curve.readerId] = readerAuc(curve, sceneCount);
    weights[curve.readerId] = weightsOf(curve, sceneCount);
    dropOffScene[curve.readerId] = curve.turns.find((turn) => !turn.continueReading)?.sceneStem;
    engagementByReader[curve.readerId] = readerEngagement(curve);
  }

  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    auc: mean(Object.values(byReader)),
    byReader,
    curves: weights,
    dropOffScene,
    engagement: mean(Object.values(engagementByReader)),
    engagementByReader,
  };
}

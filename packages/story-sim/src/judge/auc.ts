import { simDefaults } from '#sim/simDefaults';

// 독자 한 명이 씬 하나를 읽고 낸 답. quote 는 본문의 실제 부분 문자열이어야 한다.
export interface ReaderTurn {
  readonly sceneStem: string;
  readonly engagement: number;
  readonly continueReading: boolean;
  readonly reason: string;
  readonly quote: string;
}

export interface ReaderCurve {
  readonly readerId: string;
  // 독자가 덮은 뒤로는 턴이 없다. 배열 길이가 곧 읽은 씬 수다.
  readonly turns: readonly ReaderTurn[];
}

// 읽는 동안은 몰입도를 0~1로, 덮은 지점부터는 0으로 둔다. 사각형 적분이라 씬 사이의 값을
// 지어내지 않는다 — 몰입도는 연속 신호의 표본이 아니라 씬마다의 판정이다.
export function weightsOf(curve: ReaderCurve, sceneCount: number): readonly number[] {
  const scale = simDefaults.panel.engagementScaleMax;
  let stopped = false;

  return Array.from({ length: sceneCount }, (_, index) => {
    if (stopped) {
      return 0;
    }

    const turn = curve.turns[index];
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

  const weights = weightsOf(curve, sceneCount);
  return weights.reduce((total, weight) => total + weight, 0) / sceneCount;
}

export interface PanelAuc {
  readonly auc: number;
  readonly byReader: Readonly<Record<string, number>>;
  // 스칼라 하나로는 «넷 다 미지근»과 «셋은 좋고 하나가 3씬에서 덮음»이 구분되지 않는다.
  readonly curves: Readonly<Record<string, readonly number[]>>;
  readonly dropOffScene: Readonly<Record<string, string | undefined>>;
  // 8화 전부에 대한 몰입도 평균(0~1). 덮음과 무관한 둘째 눈금이다.
  readonly engagement: number;
  readonly engagementByReader: Readonly<Record<string, number>>;
}

// 덮음을 무시하고 읽은 화 전부의 몰입도를 평균한다. 안 읽힌 화(폐기 등)는 세지 않는다.
export function readerEngagement(curve: ReaderCurve): number {
  const scale = simDefaults.panel.engagementScaleMax;
  const values = curve.turns.map((turn) => Math.min(Math.max(turn.engagement, 0), scale) / scale);

  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

// AUC 는 공통 독자만으로 낸다. 장르 독자의 말은 따로 기록하고 여기 섞지 않는다.
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

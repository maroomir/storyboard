import type { KnobId, KnobSpec } from '#sim/knobs/knobRegistry';

// 스윕이 돌 지점 하나. 값이 빈 지점은 기준선이다.
export type SweepPoint = Readonly<Record<KnobId, number>>;

export interface DesignedPoint {
  readonly label: string;
  readonly knobs: SweepPoint;
}

function levelsFor(knob: KnobSpec): readonly [number, number] {
  const { min, max } = knob.bounds;
  const low = knob.kind === 'count' || knob.kind === 'chars' || knob.kind === 'weight'
    ? Math.max(min, Math.round(knob.defaultValue * 0.5))
    : Math.max(min, knob.defaultValue * 0.6);
  const high = knob.kind === 'count' || knob.kind === 'chars' || knob.kind === 'weight'
    ? Math.min(max, Math.round(knob.defaultValue * 1.5) || min + 1)
    : Math.min(max, knob.defaultValue * 1.4);

  return [low, high];
}

// 한 번에 손잡이 하나씩만 흔든다(OAT). 기준선 1점 + 손잡이마다 2점.
export function planScreening(knobs: readonly KnobSpec[]): readonly DesignedPoint[] {
  const points: DesignedPoint[] = [{ label: 'baseline', knobs: {} }];

  for (const knob of knobs) {
    const [low, high] = levelsFor(knob);

    if (low !== knob.defaultValue) {
      points.push({ label: `${knob.id}=low`, knobs: { [knob.id]: low } });
    }
    if (high !== knob.defaultValue && high !== low) {
      points.push({ label: `${knob.id}=high`, knobs: { [knob.id]: high } });
    }
  }

  return points;
}

// NOTE: 손잡이 4개에 값 3개면 전체 격자가 81점이다. 8씬 3회 정본으로 돌리면 감당이 안 되고,
// 81점이 사 주는 것은 아무도 행동으로 옮기지 않을 고차 상호작용 항이다. 주효과 넷을 전부
// 분해하는 최소 설계인 L9 직교 배열 9점을 쓴다 — 뒤 두 손잡이의 수준이 앞 둘로 정해진다.
// 직교성 덕분에 각 손잡이가 각 수준을 정확히 세 번씩 받고, 어느 두 손잡이를 골라도 아홉 조합이
// 한 번씩 나온다.
const l9GridSize = 3;

export function planFractionalGrid(
  knobs: readonly KnobSpec[],
  levels: ReadonlyMap<KnobId, readonly number[]>,
): readonly DesignedPoint[] {
  if (knobs.length !== 4) {
    throw new Error(`L9 설계는 손잡이 4개를 요구합니다 (받은 수: ${knobs.length}).`);
  }

  const points: DesignedPoint[] = [];

  for (let first = 0; first < l9GridSize; first += 1) {
    for (let second = 0; second < l9GridSize; second += 1) {
      const indices = [
        first,
        second,
        (first + second) % l9GridSize,
        (first + 2 * second) % l9GridSize,
      ];
      const knobValues: Record<string, number> = {};

      knobs.forEach((knob, position) => {
        const scale = levels.get(knob.id);
        if (scale === undefined) {
          throw new Error(`${knob.id} 의 격자 수준이 없습니다.`);
        }
        knobValues[knob.id] = scale[indices[position] as number] as number;
      });

      points.push({ label: `grid:${indices.join('')}`, knobs: knobValues });
    }
  }

  return points;
}

export function defaultGridLevels(knob: KnobSpec): readonly number[] {
  const [low, high] = levelsFor(knob);
  return [low, knob.defaultValue, high];
}

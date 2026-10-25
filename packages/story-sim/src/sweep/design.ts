import type { KnobId, KnobSpec } from '#sim/knobs/knobRegistry';

export type SweepPoint = Readonly<Record<KnobId, number>>;

export interface DesignedPoint {
  readonly label: string;
  readonly knobs: SweepPoint;
}

function levelsFor(knob: KnobSpec): readonly [number, number] {
  const { min, max } = knob.bounds;
  const low: number = knob.kind === 'count' || knob.kind === 'chars' || knob.kind === 'weight'
    ? Math.max(min, Math.round(knob.defaultValue * 0.5))
    : Math.max(min, knob.defaultValue * 0.6);
  const high: number = knob.kind === 'count' || knob.kind === 'chars' || knob.kind === 'weight'
    ? Math.min(max, Math.round(knob.defaultValue * 1.5) || min + 1)
    : Math.min(max, knob.defaultValue * 1.4);

  return [low, high];
}

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

const l9GridSize: number = 3;

export function planFractionalGrid(
  knobs: readonly KnobSpec[],
  levels: ReadonlyMap<KnobId, readonly number[]>,
): readonly DesignedPoint[] {
  if (knobs.length !== 4) {
    throw new Error(`L9 설계는 손잡이 4개를 요구합니다 (받은 수: ${knobs.length}).`);
  }

  const points: DesignedPoint[] = [];

  for (let first: number = 0; first < l9GridSize; first += 1) {
    for (let second: number = 0; second < l9GridSize; second += 1) {
      const indices: number[] = [
        first,
        second,
        (first + second) % l9GridSize,
        (first + 2 * second) % l9GridSize,
      ];
      const knobValues: Record<string, number> = {};

      knobs.forEach((knob, position) => {
        const scale: readonly number[] | undefined = levels.get(knob.id);
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

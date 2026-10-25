import {
  formatSceneBeatCoordinates,
  sceneBeatText,
  type SceneBeat,
} from '@storyboard/story-model';

import { placeWords } from './sceneBreakPlan';

// NOTE: 뼈대는 장면 첫 줄과 --- 다음 줄에 그 대목의 좌표(시각·장소·있는 사람)를 ⟪…⟫ 한 줄로 남긴다.
// 단계 사이에 «지금 몇 시, 어디, 누가 있나»를 넘기는 장부가 없어 살붙임이 앞 대목의 시각을 이어 쓰고
// 검수도 그것을 잡을 근거가 없었다(#108). 표식은 장부로 옮긴 뒤 본문에서 지운다.
const COORDINATE_MARKER: RegExp = /⟪([^⟪⟫\n]*)⟫/g;
const SCENE_BREAK_LINE: string = '---';

// 대목은 --- 로 나뉜 장면의 토막이다. segments[i]는 i번째 대목의 좌표이고, 표식이 없던 대목은 비어 있다.
export interface SceneCoordinateLedger {
  readonly segments: readonly (string | undefined)[];
  // 뼈대 표식에서 왔으면 대목 번호가 본문의 --- 와 맞는다. 비트에서 왔으면 순서만 맞는다.
  readonly isAlignedWithBreaks: boolean;
  // 파이프라인이 끊은 씬이면 대목마다 그 대목에 든 비트 번호(0부터). 모델이 끊은 씬에는 없다.
  readonly beats?: readonly (readonly number[])[];
}

export function extractSceneCoordinates(skeleton: string): {
  readonly text: string;
  readonly ledger: SceneCoordinateLedger;
} {
  const segments: (string | undefined)[] = [];
  let segmentIndex: number = 0;
  const keptLines: string[] = [];

  for (const line of skeleton.split('\n')) {
    if (line.trim() === SCENE_BREAK_LINE) {
      segmentIndex += 1;
      keptLines.push(line);
      continue;
    }

    const markers: RegExpExecArray[] = [...line.matchAll(COORDINATE_MARKER)];
    for (const marker of markers) {
      const coordinate: string = (marker[1] ?? '').trim();
      if (coordinate.length > 0 && segments[segmentIndex] === undefined) {
        segments[segmentIndex] = coordinate;
      }
    }

    const rest: string = markers.length > 0 ? line.replace(COORDINATE_MARKER, '').trim() : line;
    if (markers.length === 0 || rest.trim().length > 0) {
      keptLines.push(rest);
    }
  }

  const hasMarkers: boolean = segments.length > 0 || skeleton.includes('⟪');
  // 표식이 하나라도 있으면 끝 대목까지 자리를 잡아 두어, 뒤쪽 표식 누락도 빈 대목으로 드러난다.
  const segmentCount: number = hasMarkers ? segmentIndex + 1 : 0;

  return {
    text: hasMarkers ? keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() : skeleton,
    ledger: {
      segments: Array.from({ length: segmentCount }, (_, index) => segments[index]),
      isAlignedWithBreaks: true,
    },
  };
}

// 빈 대목이 있는 장부는 검수가 앞 대목의 좌표를 뒤 대목까지 적용해 거짓 모순을 내므로 통째로 쓰지 않는다.
export function countMissingSceneCoordinates(ledger: SceneCoordinateLedger): number {
  return ledger.segments.filter((segment) => segment === undefined).length;
}

// 뼈대가 표식을 남기지 않았을 때 객체 비트의 좌표로 대신한다. 같은 좌표가 이어지면 한 대목으로 본다.
export function sceneCoordinatesFromBeats(
  beats: readonly SceneBeat[] | undefined,
  castName: (ref: string) => string,
): SceneCoordinateLedger {
  const segments: string[] = [];

  for (const beat of beats ?? []) {
    const coordinate: string | undefined = formatSceneBeatCoordinates(beat, castName);
    if (coordinate !== undefined && segments.at(-1) !== coordinate) {
      segments.push(coordinate);
    }
  }

  return { segments, isAlignedWithBreaks: false };
}

export function hasSceneCoordinates(ledger: SceneCoordinateLedger): boolean {
  return ledger.segments.some((segment) => segment !== undefined);
}

export function listSceneCoordinates(ledger: SceneCoordinateLedger): string[] {
  return ledger.segments.flatMap((segment, index) =>
    segment === undefined ? [] : [`${index + 1}. ${segment}`],
  );
}

interface SegmentRange {
  readonly first: number;
  readonly last: number;
}

// 구간은 뼈대를 앞에서부터 자른 조각이므로 앞 구간들의 --- 수가 이 구간의 첫 대목 번호(0부터)다.
function sectionSegmentRanges(sections: readonly string[]): SegmentRange[] {
  let firstSegment: number = 0;

  return sections.map((section) => {
    const lines: string[] = section.split('\n').map((line) => line.trim());
    const breakCount: number = lines.filter((line) => line === SCENE_BREAK_LINE).length;
    // 분할기는 --- 뒤에서 자르기도 한다. 그 --- 다음 대목은 다음 구간에서 시작한다.
    const endsWithBreak: boolean = lines.filter((line) => line.length > 0).at(-1) === SCENE_BREAK_LINE;
    const range = { first: firstSegment, last: firstSegment + breakCount - (endsWithBreak ? 1 : 0) };
    firstSegment += breakCount;
    return range;
  });
}

function sectionBeats(
  ledger: SceneCoordinateLedger,
  range: SegmentRange,
  beats: readonly SceneBeat[],
): { readonly index: number; readonly beat: SceneBeat }[] {
  return (ledger.beats ?? [])
    .slice(range.first, range.last + 1)
    .flatMap((numbers) => numbers.map((index) => ({ index, beat: beats[index] as SceneBeat })))
    .filter((entry) => entry.beat !== undefined);
}

// 구간마다 장부 전체를 주되, 이 구간이 덮는 대목에 표시를 단다. 비트를 아는 장부면 그 대목 아래에
// 비트마다 좌표를 한 줄씩 더한다 — 한 대목이 여러 비트·구간에 걸칠 때 구간 쓰기가 비트별 장소를
// 모르면 인물을 좌표 밖의 방으로 옮긴다(#122).
export function sectionSceneCoordinates(
  ledger: SceneCoordinateLedger,
  sections: readonly string[],
  beats: readonly SceneBeat[] = [],
  castName: (ref: string) => string = (ref) => ref,
): string[][] {
  if (!hasSceneCoordinates(ledger)) {
    return sections.map(() => []);
  }
  if (!ledger.isAlignedWithBreaks) {
    return sections.map(() => listSceneCoordinates(ledger));
  }

  return sectionSegmentRanges(sections).map((range) =>
    ledger.segments.flatMap((segment, index) => {
      if (segment === undefined) {
        return [];
      }
      const isInSection: boolean = index >= range.first && index <= range.last;
      if (!isInSection) {
        return [`${index + 1}. ${segment}`];
      }
      const beatLines: string[] = sectionBeats(ledger, { first: index, last: index }, beats).flatMap(
        ({ index: beatIndex, beat }) => {
          const coordinate: string | undefined = formatSceneBeatCoordinates(beat, castName);
          return coordinate === undefined
            ? []
            : [`  ${index + 1}-${beatIndex + 1}. ${coordinate} — ${sceneBeatText(beat)}`];
        },
      );
      return [`${index + 1}. ${segment} ← 이번 구간`, ...beatLines];
    }),
  );
}

// 구간마다 그 구간의 비트가 선 장소들. 비트를 모르는 장부면 빈 목록이다.
export function sectionPlaces(
  ledger: SceneCoordinateLedger,
  sections: readonly string[],
  beats: readonly SceneBeat[],
): string[][] {
  if (ledger.beats === undefined || !ledger.isAlignedWithBreaks) {
    return sections.map(() => []);
  }

  return sectionSegmentRanges(sections).map((range) => [
    ...new Set(
      sectionBeats(ledger, range, beats).flatMap(({ beat }) =>
        typeof beat === 'string' || beat.place === undefined ? [] : [beat.place],
      ),
    ),
  ]);
}

// 장소 문자열들을 같은 곳인지 가리는 낱말 집합으로. 한 글자 낱말은 어디에나 섞여 들어 버린다.
export function placeWordSet(places: readonly string[]): Set<string> {
  return new Set(places.flatMap(placeWords).filter((word) => word.length >= 2));
}

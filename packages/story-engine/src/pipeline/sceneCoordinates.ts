import { formatSceneBeatCoordinates, type SceneBeat } from '@storyboard/story-model';

// NOTE: 뼈대는 장면 첫 줄과 --- 다음 줄에 그 대목의 좌표(시각·장소·있는 사람)를 ⟪…⟫ 한 줄로 남긴다.
// 단계 사이에 «지금 몇 시, 어디, 누가 있나»를 넘기는 장부가 없어 살붙임이 앞 대목의 시각을 이어 쓰고
// 검수도 그것을 잡을 근거가 없었다(#108). 표식은 장부로 옮긴 뒤 본문에서 지운다.
const COORDINATE_MARKER = /⟪([^⟪⟫\n]*)⟫/g;
const SCENE_BREAK_LINE = '---';

// 대목은 --- 로 나뉜 장면의 토막이다. segments[i]는 i번째 대목의 좌표이고, 표식이 없던 대목은 비어 있다.
export interface SceneCoordinateLedger {
  readonly segments: readonly (string | undefined)[];
  // 뼈대 표식에서 왔으면 대목 번호가 본문의 --- 와 맞는다. 비트에서 왔으면 순서만 맞는다.
  readonly isAlignedWithBreaks: boolean;
}

export function extractSceneCoordinates(skeleton: string): {
  readonly text: string;
  readonly ledger: SceneCoordinateLedger;
} {
  const segments: (string | undefined)[] = [];
  let segmentIndex = 0;
  const keptLines: string[] = [];

  for (const line of skeleton.split('\n')) {
    if (line.trim() === SCENE_BREAK_LINE) {
      segmentIndex += 1;
      keptLines.push(line);
      continue;
    }

    const markers = [...line.matchAll(COORDINATE_MARKER)];
    for (const marker of markers) {
      const coordinate = (marker[1] ?? '').trim();
      if (coordinate.length > 0 && segments[segmentIndex] === undefined) {
        segments[segmentIndex] = coordinate;
      }
    }

    const rest = markers.length > 0 ? line.replace(COORDINATE_MARKER, '').trim() : line;
    if (markers.length === 0 || rest.trim().length > 0) {
      keptLines.push(rest);
    }
  }

  const hasMarkers = segments.length > 0 || skeleton.includes('⟪');

  return {
    text: hasMarkers ? keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() : skeleton,
    ledger: {
      segments: Array.from({ length: segments.length }, (_, index) => segments[index]),
      isAlignedWithBreaks: true,
    },
  };
}

// 뼈대가 표식을 남기지 않았을 때 객체 비트의 좌표로 대신한다. 같은 좌표가 이어지면 한 대목으로 본다.
export function sceneCoordinatesFromBeats(
  beats: readonly SceneBeat[] | undefined,
  castName: (ref: string) => string,
): SceneCoordinateLedger {
  const segments: string[] = [];

  for (const beat of beats ?? []) {
    const coordinate = formatSceneBeatCoordinates(beat, castName);
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

// 구간마다 장부 전체를 주되, 이 구간이 덮는 대목에 표시를 단다. 구간은 뼈대를 앞에서부터 자른
// 조각이므로 앞 구간들의 --- 수가 이 구간의 첫 대목 번호다.
export function sectionSceneCoordinates(
  ledger: SceneCoordinateLedger,
  sections: readonly string[],
): string[][] {
  if (!hasSceneCoordinates(ledger)) {
    return sections.map(() => []);
  }
  if (!ledger.isAlignedWithBreaks) {
    return sections.map(() => listSceneCoordinates(ledger));
  }

  let firstSegment = 0;

  return sections.map((section) => {
    const lines = section.split('\n').map((line) => line.trim());
    const breakCount = lines.filter((line) => line === SCENE_BREAK_LINE).length;
    // 분할기는 --- 뒤에서 자르기도 한다. 그 --- 다음 대목은 다음 구간에서 시작한다.
    const endsWithBreak = lines.filter((line) => line.length > 0).at(-1) === SCENE_BREAK_LINE;
    const lastSegment = firstSegment + breakCount - (endsWithBreak ? 1 : 0);
    const coordinates = ledger.segments.flatMap((segment, index) => {
      if (segment === undefined) {
        return [];
      }
      const isInSection = index >= firstSegment && index <= lastSegment;
      return [`${index + 1}. ${segment}${isInSection ? ' ← 이번 구간' : ''}`];
    });
    firstSegment += breakCount;
    return coordinates;
  });
}

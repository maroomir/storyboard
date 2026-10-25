import {
  formatSceneBeatCoordinates,
  sceneBeatText,
  type SceneBeat,
} from '@storyboard/story-model';

import { placeWords } from './sceneBreakPlan';

const COORDINATE_MARKER: RegExp = /⟪([^⟪⟫\n]*)⟫/g;
const SCENE_BREAK_LINE: string = '---';

interface SegmentRange {
  readonly first: number;
  readonly last: number;
}

export interface SceneCoordinateLedger {
  readonly segments: readonly (string | undefined)[];
  readonly isAlignedWithBreaks: boolean;
  readonly beats?: readonly (readonly number[])[];
}

export interface ExtractedSceneCoordinates {
  readonly text: string;
  readonly ledger: SceneCoordinateLedger;
}

export function extractSceneCoordinates(skeleton: string): ExtractedSceneCoordinates {
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
  const segmentCount: number = hasMarkers ? segmentIndex + 1 : 0;

  return {
    text: hasMarkers ? keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() : skeleton,
    ledger: {
      segments: Array.from({ length: segmentCount }, (_, index) => segments[index]),
      isAlignedWithBreaks: true,
    },
  };
}

export function countMissingSceneCoordinates(ledger: SceneCoordinateLedger): number {
  return ledger.segments.filter((segment) => segment === undefined).length;
}

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

function sectionSegmentRanges(sections: readonly string[]): SegmentRange[] {
  let firstSegment: number = 0;

  return sections.map((section) => {
    const lines: string[] = section.split('\n').map((line) => line.trim());
    const breakCount: number = lines.filter((line) => line === SCENE_BREAK_LINE).length;
    const endsWithBreak: boolean = lines.filter((line) => line.length > 0).at(-1) === SCENE_BREAK_LINE;
    const range: SegmentRange = { first: firstSegment, last: firstSegment + breakCount - (endsWithBreak ? 1 : 0) };
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

export function placeWordSet(places: readonly string[]): Set<string> {
  return new Set(places.flatMap(placeWords).filter((word) => word.length >= 2));
}

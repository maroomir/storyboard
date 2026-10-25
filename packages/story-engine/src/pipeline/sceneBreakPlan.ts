import {
  renderSceneBeat,
  sceneBeatCoordinateLabels,
  type SceneBeat,
  type SceneBeatDetail,
} from '@storyboard/story-model';

import { countSharedShingles, normalizeForMatch } from './textMatch';

const SCENE_BREAK_LINE: string = '---';
const SEGMENT_MARKER: RegExp = /⟪\s*대목\s*(\d+)\s*⟫/g;
const ANY_MARKER: RegExp = /⟪[^⟪⟫\n]*⟫/g;

interface SkeletonCallBeats {
  beats: number[];
  markers: number[];
}

export interface PlannedSceneSegment {
  readonly beats: readonly number[];
  readonly coordinate: string | undefined;
}

export interface SceneBreakPlan {
  readonly segments: readonly PlannedSceneSegment[];
}

interface DayPeriod {
  readonly words: readonly string[];
  readonly pm: boolean;
}

const dayPeriods: readonly DayPeriod[] = [
  { words: ['새벽'], pm: false },
  { words: ['아침'], pm: false },
  { words: ['오전'], pm: false },
  { words: ['점심', '정오', '한낮', '낮'], pm: true },
  { words: ['오후', '방과 후', '하교'], pm: true },
  { words: ['해 질 녘', '해질녘', '노을', '저녁'], pm: true },
  { words: ['밤', '자정', '심야'], pm: true },
];

const timeSpanPattern: RegExp = /까지|경과|동안|내내/;

const dayChangePattern: RegExp =
  /다음\s*날|이튿날|며칠\s*(?:뒤|후)|\d+\s*일\s*(?:뒤|후)|일주일\s*(?:뒤|후)|다음\s*주/;

const placeStopWords: Set<string> = new Set([
  '앞',
  '뒤',
  '옆',
  '안',
  '밖',
  '근처',
  '그리고',
  '및',
  '쪽',
  '사이',
]);

interface ReadTime {
  readonly period: number | undefined;
  readonly minutes: number | undefined;
  readonly isNextDay: boolean;
  readonly isSpan: boolean;
}

function readPeriod(time: string): number | undefined {
  let found: { period: number; at: number } | undefined;

  dayPeriods.forEach((period, index) => {
    for (const word of period.words) {
      const at: number = time.lastIndexOf(word);
      if (at >= 0 && (found === undefined || at > found.at)) {
        found = { period: index, at };
      }
    }
  });

  return found?.period;
}

function readMinutes(time: string, period: number | undefined): number | undefined {
  const clock: RegExpExecArray | null = /(\d{1,2}):(\d{2})/.exec(time);
  if (clock) {
    return Number(clock[1]) * 60 + Number(clock[2]);
  }

  const hourMatch: RegExpExecArray | null = /(\d{1,2})\s*시(?:\s*(반)|\s*(\d{1,2})\s*분)?/.exec(
    time,
  );
  if (!hourMatch) {
    return undefined;
  }

  let hour: number = Number(hourMatch[1]);
  const minute: number = hourMatch[2] ? 30 : hourMatch[3] ? Number(hourMatch[3]) : 0;
  const isAfternoon: boolean = period !== undefined && dayPeriods[period]?.pm === true;

  if (isAfternoon && hour < 12 && !(period === 3 && hour >= 11)) {
    hour += 12;
  }

  return hour * 60 + minute;
}

function readTime(time: string): ReadTime {
  const period: number | undefined = readPeriod(time);
  return {
    period,
    minutes: readMinutes(time, period),
    isNextDay: dayChangePattern.test(time),
    isSpan: timeSpanPattern.test(time),
  };
}

export function isTimeJump(previous: string, next: string, jumpMinutes: number): boolean {
  const before: ReadTime = readTime(previous);
  const after: ReadTime = readTime(next);

  if (after.isNextDay || before.isSpan) {
    return true;
  }

  if (before.minutes !== undefined && after.minutes !== undefined) {
    return Math.abs(after.minutes - before.minutes) >= jumpMinutes;
  }

  return (
    before.period !== undefined && after.period !== undefined && before.period !== after.period
  );
}

export function placeWords(place: string): string[] {
  return place
    .split(/[\s,·、/()]+/)
    .map((word) => word.replace(/(?:과|와|의|에서|으로|로)$/, ''))
    .filter((word) => word.length > 0 && !placeStopWords.has(word));
}

function detailOf(beat: SceneBeat): Exclude<SceneBeat, string> | undefined {
  return typeof beat === 'string' ? undefined : beat;
}

function shouldBreakBefore(
  beat: SceneBeat,
  previous: SceneBeat,
  segmentPlaceWords: ReadonlySet<string>,
  jumpMinutes: number,
): boolean {
  const detail: Exclude<SceneBeat, string> | undefined = detailOf(beat);
  if (detail?.break !== undefined) {
    return detail.break;
  }

  if (detail?.place !== undefined && segmentPlaceWords.size > 0) {
    const words: string[] = placeWords(detail.place);
    if (words.length > 0 && !words.some((word) => segmentPlaceWords.has(word))) {
      return true;
    }
  }

  const previousTime: string | undefined = detailOf(previous)?.time;
  return (
    detail?.time !== undefined &&
    previousTime !== undefined &&
    isTimeJump(previousTime, detail.time, jumpMinutes)
  );
}

function formatSegmentCoordinate(
  beats: readonly SceneBeat[],
  castName: (ref: string) => string,
): string | undefined {
  const details: SceneBeatDetail[] = beats.map(detailOf).filter((detail) => detail !== undefined);
  const unique = (values: readonly (string | undefined)[]): string[] => [
    ...new Set(values.filter((value): value is string => value !== undefined)),
  ];

  const cast: string[] = unique(details.flatMap((detail) => (detail.cast ?? []).map(castName)));
  const places: string[] = unique(details.map((detail) => detail.place));
  const times: string[] = unique(details.map((detail) => detail.time));
  const timeSpan: string | undefined =
    times.length > 1 ? `${times[0] as string} ~ ${times.at(-1) as string}` : times[0];

  const parts: string[] = [
    cast.length > 0 ? `${sceneBeatCoordinateLabels.cast}: ${cast.join(', ')}` : undefined,
    places.length > 0 ? `${sceneBeatCoordinateLabels.place}: ${places.join(' → ')}` : undefined,
    timeSpan !== undefined ? `${sceneBeatCoordinateLabels.time}: ${timeSpan}` : undefined,
  ].filter((part): part is string => part !== undefined);

  return parts.length > 0 ? parts.join(' / ') : undefined;
}

export function planSceneBreaks(
  beats: readonly SceneBeat[] | undefined,
  castName: (ref: string) => string,
  jumpMinutes: number,
): SceneBreakPlan | undefined {
  const list: readonly SceneBeat[] = beats ?? [];
  const hasCoordinates: boolean = list.some((beat) => {
    const detail: Exclude<SceneBeat, string> | undefined = detailOf(beat);
    return detail?.place !== undefined || detail?.time !== undefined || detail?.break !== undefined;
  });

  if (list.length === 0 || !hasCoordinates) {
    return undefined;
  }

  const groups: number[][] = [];
  let placeWordSet: Set<string> = new Set<string>();

  list.forEach((beat, index) => {
    const previous: SceneBeat | undefined = list[index - 1];
    if (previous === undefined || shouldBreakBefore(beat, previous, placeWordSet, jumpMinutes)) {
      groups.push([]);
      placeWordSet = new Set();
    }

    groups.at(-1)?.push(index);
    const place: string | undefined = detailOf(beat)?.place;
    if (place !== undefined) {
      placeWords(place).forEach((word) => placeWordSet.add(word));
    }
  });

  return {
    segments: groups.map((group) => ({
      beats: group,
      coordinate: formatSegmentCoordinate(
        group.map((index) => list[index] as SceneBeat),
        castName,
      ),
    })),
  };
}

export function renderPlannedNarrative(
  beats: readonly SceneBeat[],
  plan: SceneBreakPlan,
  castName: (ref: string) => string,
  onlyBeats?: readonly number[],
): string {
  return plan.segments
    .flatMap((segment, index) => {
      const chosen: number[] = segment.beats.filter(
        (beat) => onlyBeats === undefined || onlyBeats.includes(beat),
      );
      if (chosen.length === 0) {
        return [];
      }

      const rendered: string[] = chosen.map((beat) =>
        renderSceneBeat(beats[beat] as SceneBeat, castName),
      );
      const marker: string = chosen[0] === segment.beats[0] ? `⟪대목 ${index + 1}⟫\n` : '';
      return [`${marker}${rendered.join('\n\n')}`];
    })
    .join('\n\n');
}

export interface SkeletonCall {
  readonly beats: readonly number[];
  readonly markers: readonly number[];
}

export function planSkeletonCalls(
  plan: SceneBreakPlan,
  targetLength: number | undefined,
  charsPerCall: number,
): SkeletonCall[] {
  const totalBeats: number = plan.segments.reduce((sum, segment) => sum + segment.beats.length, 0);
  if (targetLength === undefined || totalBeats === 0) {
    return [
      {
        beats: plan.segments.flatMap((segment) => segment.beats),
        markers: plan.segments.map((_, index) => index + 1),
      },
    ];
  }

  const shareOf = (beatCount: number): number => (targetLength * beatCount) / totalBeats;
  const calls: SkeletonCallBeats[] = [];

  plan.segments.forEach((segment, index) => {
    const last: SkeletonCallBeats | undefined = calls.at(-1);
    if (last !== undefined && shareOf(last.beats.length + segment.beats.length) <= charsPerCall) {
      last.beats.push(...segment.beats);
      last.markers.push(index + 1);
      return;
    }

    const chunkCount: number = Math.max(1, Math.ceil(shareOf(segment.beats.length) / charsPerCall));
    let rest: number[] = [...segment.beats];
    for (let chunk: number = 0; chunk < chunkCount; chunk += 1) {
      const size: number = Math.ceil(rest.length / (chunkCount - chunk));
      calls.push({ beats: rest.slice(0, size), markers: chunk === 0 ? [index + 1] : [] });
      rest = rest.slice(size);
    }
  });

  return calls;
}

export function ensureLeadingMarker(text: string, segmentNumber: number): string {
  const hasMarker: boolean = [...text.matchAll(SEGMENT_MARKER)].some(
    (match) => Number(match[1]) === segmentNumber,
  );
  return hasMarker ? text : `⟪대목 ${segmentNumber}⟫\n${text}`;
}

export function keepOnlyMarkers(text: string, allowed: readonly number[]): string {
  return text
    .split('\n')
    .flatMap((line) => {
      const stripped: string = line.replace(SEGMENT_MARKER, (marker, number: string) =>
        allowed.includes(Number(number)) ? marker : '',
      );
      return stripped === line || stripped.trim().length > 0 ? [stripped] : [];
    })
    .join('\n');
}

export function countMissingSegmentMarkers(
  text: string,
  segmentNumbers: readonly number[],
): number {
  const seen: Set<number> = new Set(
    [...text.matchAll(SEGMENT_MARKER)].map((match) => Number(match[1])),
  );
  return segmentNumbers.filter((segmentNumber) => !seen.has(segmentNumber)).length;
}

export interface PlannedBreakResult {
  readonly text: string;
  readonly coordinates: readonly (string | undefined)[];
  readonly beats: readonly (readonly number[])[];
  readonly missingMarkers: number;
  readonly hasNoMarkers: boolean;
}

export function applyPlannedSceneBreaks(
  skeleton: string,
  plan: SceneBreakPlan,
): PlannedBreakResult {
  const out: string[] = [];
  const seen: Set<number> = new Set<number>();
  const coordinates: (string | undefined)[] = [];
  const openingNumbers: number[] = [];
  const hasContent = (): boolean => out.some((line) => line.trim().length > 0);
  const openSegment = (segmentNumber: number): void => {
    coordinates.push(plan.segments[segmentNumber - 1]?.coordinate);
    openingNumbers.push(segmentNumber);
  };

  for (const line of skeleton.split('\n')) {
    if (line.trim() === SCENE_BREAK_LINE) {
      continue;
    }

    const markers: number[] = [...line.matchAll(SEGMENT_MARKER)].map((match) => Number(match[1]));
    for (const segmentNumber of markers) {
      if (seen.has(segmentNumber) || segmentNumber < 1 || segmentNumber > plan.segments.length) {
        continue;
      }

      seen.add(segmentNumber);
      if (segmentNumber === 1 || !hasContent()) {
        if (coordinates.length === 0) {
          openSegment(segmentNumber);
        }
        continue;
      }

      if (coordinates.length === 0) {
        openSegment(1);
      }
      out.push('', SCENE_BREAK_LINE, '');
      openSegment(segmentNumber);
    }

    const rest: string = line.replace(ANY_MARKER, '');
    if (rest === line) {
      out.push(line);
    } else if (rest.trim().length > 0) {
      out.push(rest.trim());
    }
  }

  if (coordinates.length === 0) {
    openSegment(1);
  }

  const beats: number[][] = openingNumbers.map((opening, index) => {
    const next: number = openingNumbers[index + 1] ?? plan.segments.length + 1;
    const from: number = index === 0 ? 1 : opening;
    return plan.segments.slice(from - 1, next - 1).flatMap((segment) => segment.beats);
  });

  return {
    text: out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    coordinates,
    beats,
    missingMarkers: plan.segments.length - seen.size,
    hasNoMarkers: seen.size === 0,
  };
}

export function countSceneBreakLines(text: string): number {
  return text.split('\n').filter((line) => line.trim() === SCENE_BREAK_LINE).length;
}

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

function similarity(paragraph: string, reference: string): number {
  const needle: string = normalizeForMatch(paragraph);
  return needle.length === 0
    ? 0
    : countSharedShingles(needle, normalizeForMatch(reference)) / needle.length;
}

export function restoreSceneBreaks(sectionSkeleton: string, expanded: string): string | undefined {
  const parts: string[] = sectionSkeleton.split('\n');
  const skeletonParts: string[][] = [[]];
  for (const line of parts) {
    if (line.trim() === SCENE_BREAK_LINE) {
      skeletonParts.push([]);
    } else {
      skeletonParts.at(-1)?.push(line);
    }
  }
  const segments: string[] = skeletonParts.map((lines) => lines.join('\n').trim());
  const paragraphs: string[] = paragraphsOf(
    expanded
      .split('\n')
      .filter((line) => line.trim() !== SCENE_BREAK_LINE)
      .join('\n'),
  );

  const leadingBreak: boolean = segments[0] === '';
  const trailingBreak: boolean = segments.length > 1 && segments.at(-1) === '';
  const inner: string[] = segments.slice(leadingBreak ? 1 : 0, trailingBreak ? -1 : undefined);
  const breakBefore: number[] = [];
  let lastIndex: number = 0;

  for (let segment: number = 1; segment < inner.length; segment += 1) {
    const current: string = inner[segment] as string;
    const anchor: string = paragraphsOf(current)[0] ?? '';
    let best: { index: number; score: number } | undefined;

    for (let index: number = lastIndex + 1; index < paragraphs.length; index += 1) {
      const score: number = similarity(anchor, paragraphs[index] as string);
      if (score > 0 && (best === undefined || score > best.score)) {
        best = { index, score };
      }
    }

    if (best === undefined) {
      return undefined;
    }

    let index: number = best.index;
    const before: string | undefined = paragraphs[index - 1];
    if (
      before !== undefined &&
      index - 1 > lastIndex &&
      similarity(before, current) > similarity(before, inner[segment - 1] as string)
    ) {
      index -= 1;
    }

    breakBefore.push(index);
    lastIndex = index;
  }

  const blocks: string[] = [];
  paragraphs.forEach((paragraph, index) => {
    if (breakBefore.includes(index)) {
      blocks.push(SCENE_BREAK_LINE);
    }
    blocks.push(paragraph);
  });

  return [
    ...(leadingBreak ? [SCENE_BREAK_LINE] : []),
    ...blocks,
    ...(trailingBreak ? [SCENE_BREAK_LINE] : []),
  ].join('\n\n');
}

const quotedLine: RegExp = /[“"][^”"\n]+[”"]/g;

function beatCastSize(beat: SceneBeat | undefined): number {
  return detailOf(beat ?? '')?.cast?.length ?? 0;
}

function shortBeatText(beat: SceneBeat): string {
  const text: string = typeof beat === 'string' ? beat : beat.text;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

export function findThinDialogueBeats(
  skeleton: string,
  plan: SceneBreakPlan,
  beats: readonly SceneBeat[],
  thinTurns: number,
): string[] {
  const textBySegment: Map<number, string> = new Map<number, string>();
  let current: number | undefined;

  for (const line of skeleton.split('\n')) {
    const marker: RegExpExecArray | undefined = [...line.matchAll(SEGMENT_MARKER)].at(-1);
    if (marker) {
      current = Number(marker[1]);
    }
    if (current !== undefined) {
      textBySegment.set(current, `${textBySegment.get(current) ?? ''}\n${line}`);
    }
  }

  return plan.segments.flatMap((segment, index) => {
    const conversational: number[] = segment.beats.filter((beat) => beatCastSize(beats[beat]) >= 2);
    const text: string | undefined = textBySegment.get(index + 1);
    if (conversational.length === 0 || text === undefined) {
      return [];
    }

    const turns: number = text.match(quotedLine)?.length ?? 0;
    return turns < thinTurns * conversational.length
      ? conversational.map((beat) => shortBeatText(beats[beat] as SceneBeat))
      : [];
  });
}

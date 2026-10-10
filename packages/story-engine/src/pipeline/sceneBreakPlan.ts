import {
  renderSceneBeat,
  sceneBeatCoordinateLabels,
  type SceneBeat,
} from '@storyboard/story-model';

import { countSharedShingles, normalizeForMatch } from './textMatch';

// NOTE: 장면 전환(---)은 모델에 맡기면 지켜지지 않았다(#115: 42비트 중 40곳에서 끊음, #112: 살붙임이
// 지움). 비트에 좌표가 있으면 파이프라인이 끊는 자리를 정해 뼈대 입력에 ⟪대목 n⟫ 으로 미리 표시하고,
// 뼈대 결과의 --- 는 그 표식 앞에만 다시 놓는다. 좌표가 없는 씬은 종전대로 모델 재량이다.

const SCENE_BREAK_LINE = '---';
const SEGMENT_MARKER = /⟪\s*대목\s*(\d+)\s*⟫/g;
const ANY_MARKER = /⟪[^⟪⟫\n]*⟫/g;

export interface PlannedSceneSegment {
  // 이 대목에 드는 비트 번호(0부터).
  readonly beats: readonly number[];
  readonly coordinate: string | undefined;
}

export interface SceneBreakPlan {
  readonly segments: readonly PlannedSceneSegment[];
}

// 시간대 낱말과 그 순서. 둘 다 시:분이 읽히지 않는 시각은 이 순서가 바뀔 때 전환으로 본다.
const dayPeriods = [
  { words: ['새벽'], pm: false },
  { words: ['아침'], pm: false },
  { words: ['오전'], pm: false },
  { words: ['점심', '정오', '한낮', '낮'], pm: true },
  { words: ['오후', '방과 후', '하교'], pm: true },
  { words: ['해 질 녘', '해질녘', '노을', '저녁'], pm: true },
  { words: ['밤', '자정', '심야'], pm: true },
] as const;

// 날이 바뀌었다고 적힌 시각은 언제나 전환이다.
const dayChangePattern =
  /다음\s*날|이튿날|며칠\s*(?:뒤|후)|\d+\s*일\s*(?:뒤|후)|일주일\s*(?:뒤|후)|다음\s*주/;

// 장소에서 같은 곳인지 가리는 데 쓰지 않는 낱말.
const placeStopWords = new Set([
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
}

// 문자열에서 마지막으로 언급된 시간대. «오전부터 오후까지»는 끝난 때인 오후다.
function readPeriod(time: string): number | undefined {
  let found: { period: number; at: number } | undefined;

  dayPeriods.forEach((period, index) => {
    for (const word of period.words) {
      const at = time.lastIndexOf(word);
      if (at >= 0 && (found === undefined || at > found.at)) {
        found = { period: index, at };
      }
    }
  });

  return found?.period;
}

function readMinutes(time: string, period: number | undefined): number | undefined {
  const clock = /(\d{1,2}):(\d{2})/.exec(time);
  if (clock) {
    return Number(clock[1]) * 60 + Number(clock[2]);
  }

  const hourMatch = /(\d{1,2})\s*시(?:\s*(반)|\s*(\d{1,2})\s*분)?/.exec(time);
  if (!hourMatch) {
    return undefined;
  }

  let hour = Number(hourMatch[1]);
  const minute = hourMatch[2] ? 30 : hourMatch[3] ? Number(hourMatch[3]) : 0;
  const isAfternoon = period !== undefined && dayPeriods[period]?.pm === true;

  if (isAfternoon && hour < 12 && !(period === 3 && hour >= 11)) {
    hour += 12;
  }

  return hour * 60 + minute;
}

function readTime(time: string): ReadTime {
  const period = readPeriod(time);
  return { period, minutes: readMinutes(time, period), isNextDay: dayChangePattern.test(time) };
}

export function isTimeJump(previous: string, next: string, jumpMinutes: number): boolean {
  const before = readTime(previous);
  const after = readTime(next);

  if (after.isNextDay) {
    return true;
  }

  if (before.minutes !== undefined && after.minutes !== undefined) {
    return Math.abs(after.minutes - before.minutes) >= jumpMinutes;
  }

  return (
    before.period !== undefined && after.period !== undefined && before.period !== after.period
  );
}

function placeWords(place: string): string[] {
  return place
    .split(/[\s,·、/()]+/)
    .map((word) => word.replace(/(?:과|와|의|에서|으로|로)$/, ''))
    .filter((word) => word.length > 0 && !placeStopWords.has(word));
}

function detailOf(beat: SceneBeat): Exclude<SceneBeat, string> | undefined {
  return typeof beat === 'string' ? undefined : beat;
}

// 비트 사이에서 끊을지. 작가의 break 가 우선이고, 다음은 장소다 — 다음 비트의 장소가 지금 대목의
// 장소들과 낱말 하나도 겹치지 않으면 다른 곳이다(«집 현관»→«집 거실»은 같은 집). 마지막은 시각이다.
function shouldBreakBefore(
  beat: SceneBeat,
  previous: SceneBeat,
  segmentPlaceWords: ReadonlySet<string>,
  jumpMinutes: number,
): boolean {
  const detail = detailOf(beat);
  if (detail?.break !== undefined) {
    return detail.break;
  }

  if (detail?.place !== undefined && segmentPlaceWords.size > 0) {
    const words = placeWords(detail.place);
    if (words.length > 0 && !words.some((word) => segmentPlaceWords.has(word))) {
      return true;
    }
  }

  const previousTime = detailOf(previous)?.time;
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
  const details = beats.map(detailOf).filter((detail) => detail !== undefined);
  const unique = (values: readonly (string | undefined)[]): string[] => [
    ...new Set(values.filter((value): value is string => value !== undefined)),
  ];

  const cast = unique(details.flatMap((detail) => (detail.cast ?? []).map(castName)));
  const places = unique(details.map((detail) => detail.place));
  const times = unique(details.map((detail) => detail.time));
  const timeSpan =
    times.length > 1 ? `${times[0] as string} ~ ${times.at(-1) as string}` : times[0];

  const parts = [
    cast.length > 0 ? `${sceneBeatCoordinateLabels.cast}: ${cast.join(', ')}` : undefined,
    places.length > 0 ? `${sceneBeatCoordinateLabels.place}: ${places.join(' → ')}` : undefined,
    timeSpan !== undefined ? `${sceneBeatCoordinateLabels.time}: ${timeSpan}` : undefined,
  ].filter((part): part is string => part !== undefined);

  return parts.length > 0 ? parts.join(' / ') : undefined;
}

// 좌표(장소·시각·break)가 있는 비트가 하나도 없으면 계획하지 않는다 — 모델 재량으로 남는다.
export function planSceneBreaks(
  beats: readonly SceneBeat[] | undefined,
  castName: (ref: string) => string,
  jumpMinutes: number,
): SceneBreakPlan | undefined {
  const list = beats ?? [];
  const hasCoordinates = list.some((beat) => {
    const detail = detailOf(beat);
    return detail?.place !== undefined || detail?.time !== undefined || detail?.break !== undefined;
  });

  if (list.length === 0 || !hasCoordinates) {
    return undefined;
  }

  const groups: number[][] = [];
  let placeWordSet = new Set<string>();

  list.forEach((beat, index) => {
    const previous = list[index - 1];
    if (previous === undefined || shouldBreakBefore(beat, previous, placeWordSet, jumpMinutes)) {
      groups.push([]);
      placeWordSet = new Set();
    }

    groups.at(-1)?.push(index);
    const place = detailOf(beat)?.place;
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

// 뼈대에 넘기는 사건 목록. 대목마다 ⟪대목 n⟫ 줄을 앞세운다.
export function renderPlannedNarrative(
  beats: readonly SceneBeat[],
  plan: SceneBreakPlan,
  castName: (ref: string) => string,
): string {
  return plan.segments
    .map((segment, index) => {
      const rendered = segment.beats.map((beat) =>
        renderSceneBeat(beats[beat] as SceneBeat, castName),
      );
      return `⟪대목 ${index + 1}⟫\n${rendered.join('\n\n')}`;
    })
    .join('\n\n');
}

export interface PlannedBreakResult {
  readonly text: string;
  // 결과 본문의 대목 순서대로 그 좌표. --- 수 + 1 과 같다.
  readonly coordinates: readonly (string | undefined)[];
  readonly missingMarkers: number;
  // 표식을 하나도 옮겨 적지 않았다. 그때 --- 를 모두 지우면 전환이 다 사라지므로 호출자는 모델의
  // --- 를 그대로 쓴다.
  readonly hasNoMarkers: boolean;
}

// 모델이 쓴 --- 를 모두 지우고, ⟪대목 n⟫ 표식 앞에만 다시 놓는다. 빠진 표식의 대목은 앞 대목에 붙는다.
export function applyPlannedSceneBreaks(
  skeleton: string,
  plan: SceneBreakPlan,
): PlannedBreakResult {
  const out: string[] = [];
  const seen = new Set<number>();
  const coordinates: (string | undefined)[] = [];
  const hasContent = (): boolean => out.some((line) => line.trim().length > 0);

  for (const line of skeleton.split('\n')) {
    if (line.trim() === SCENE_BREAK_LINE) {
      continue;
    }

    const markers = [...line.matchAll(SEGMENT_MARKER)].map((match) => Number(match[1]));
    for (const segmentNumber of markers) {
      if (seen.has(segmentNumber) || segmentNumber < 1 || segmentNumber > plan.segments.length) {
        continue;
      }

      seen.add(segmentNumber);
      if (segmentNumber === 1 || !hasContent()) {
        if (coordinates.length === 0) {
          coordinates.push(plan.segments[segmentNumber - 1]?.coordinate);
        }
        continue;
      }

      if (coordinates.length === 0) {
        coordinates.push(plan.segments[0]?.coordinate);
      }
      out.push('', SCENE_BREAK_LINE, '');
      coordinates.push(plan.segments[segmentNumber - 1]?.coordinate);
    }

    const rest = line.replace(ANY_MARKER, '');
    if (rest === line) {
      out.push(line);
    } else if (rest.trim().length > 0) {
      out.push(rest.trim());
    }
  }

  if (coordinates.length === 0) {
    coordinates.push(plan.segments[0]?.coordinate);
  }

  return {
    text: out
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    coordinates,
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
  const needle = normalizeForMatch(paragraph);
  return needle.length === 0
    ? 0
    : countSharedShingles(needle, normalizeForMatch(reference)) / needle.length;
}

// 살붙임이 뼈대 조각의 --- 를 지우거나 더했을 때, 뼈대 조각의 대목마다 그 첫 문단과 가장 닮은
// 살붙임 문단 앞에 --- 를 다시 놓는다(#112). 바로 앞 문단이 이 대목을 더 닮았으면(전환 뒤 첫머리의
// 설정 문장) 한 문단 당긴다. 자리를 못 찾으면 undefined.
export function restoreSceneBreaks(sectionSkeleton: string, expanded: string): string | undefined {
  const parts = sectionSkeleton.split('\n');
  const skeletonParts: string[][] = [[]];
  for (const line of parts) {
    if (line.trim() === SCENE_BREAK_LINE) {
      skeletonParts.push([]);
    } else {
      skeletonParts.at(-1)?.push(line);
    }
  }
  const segments = skeletonParts.map((lines) => lines.join('\n').trim());
  const paragraphs = paragraphsOf(
    expanded
      .split('\n')
      .filter((line) => line.trim() !== SCENE_BREAK_LINE)
      .join('\n'),
  );

  const leadingBreak = segments[0] === '';
  const trailingBreak = segments.length > 1 && segments.at(-1) === '';
  const inner = segments.slice(leadingBreak ? 1 : 0, trailingBreak ? -1 : undefined);
  const breakBefore: number[] = [];
  let lastIndex = 0;

  for (let segment = 1; segment < inner.length; segment += 1) {
    const current = inner[segment] as string;
    const anchor = paragraphsOf(current)[0] ?? '';
    let best: { index: number; score: number } | undefined;

    for (let index = lastIndex + 1; index < paragraphs.length; index += 1) {
      const score = similarity(anchor, paragraphs[index] as string);
      if (score > 0 && (best === undefined || score > best.score)) {
        best = { index, score };
      }
    }

    if (best === undefined) {
      return undefined;
    }

    let index = best.index;
    const before = paragraphs[index - 1];
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

const quotedLine = /[“"][^”"\n]+[”"]/g;

function beatCastSize(beat: SceneBeat | undefined): number {
  return detailOf(beat ?? '')?.cast?.length ?? 0;
}

function shortBeatText(beat: SceneBeat): string {
  const text = typeof beat === 'string' ? beat : beat.text;
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

// NOTE: 미달 뼈대를 «더 쓰라»로만 다시 부르면 비트마다 고르게 조금씩 늘 뿐, 긴 설전이 두세 턴으로
// 끝나는 비트는 그대로였다(#115: 42비트가 비트당 228자로 수렴). 대목마다 둘 이상이 나오는 사건 수와
// 대사 수를 세어, 사건당 대사가 thinTurns 에 못 미치는 대목의 그런 사건들을 지목한다.
export function findThinDialogueBeats(
  skeleton: string,
  plan: SceneBreakPlan,
  beats: readonly SceneBeat[],
  thinTurns: number,
): string[] {
  const textBySegment = new Map<number, string>();
  let current: number | undefined;

  for (const line of skeleton.split('\n')) {
    const marker = [...line.matchAll(SEGMENT_MARKER)].at(-1);
    if (marker) {
      current = Number(marker[1]);
    }
    if (current !== undefined) {
      textBySegment.set(current, `${textBySegment.get(current) ?? ''}\n${line}`);
    }
  }

  return plan.segments.flatMap((segment, index) => {
    const conversational = segment.beats.filter((beat) => beatCastSize(beats[beat]) >= 2);
    const text = textBySegment.get(index + 1);
    if (conversational.length === 0 || text === undefined) {
      return [];
    }

    const turns = text.match(quotedLine)?.length ?? 0;
    return turns < thinTurns * conversational.length
      ? conversational.map((beat) => shortBeatText(beats[beat] as SceneBeat))
      : [];
  });
}

import {
  renderSceneBeat,
  sceneBeatCoordinateLabels,
  type SceneBeat,
  type SceneBeatDetail,
} from '@storyboard/story-model';

import { countSharedShingles, normalizeForMatch } from './textMatch';

// NOTE: 장면 전환(---)은 모델에 맡기면 지켜지지 않았다(#115: 42비트 중 40곳에서 끊음, #112: 살붙임이
// 지움). 비트에 좌표가 있으면 파이프라인이 끊는 자리를 정해 뼈대 입력에 ⟪대목 n⟫ 으로 미리 표시하고,
// 뼈대 결과의 --- 는 그 표식 앞에만 다시 놓는다. 좌표가 없는 씬은 종전대로 모델 재량이다.

const SCENE_BREAK_LINE: string = '---';
const SEGMENT_MARKER: RegExp = /⟪\s*대목\s*(\d+)\s*⟫/g;
const ANY_MARKER: RegExp = /⟪[^⟪⟫\n]*⟫/g;

interface SkeletonCallBeats {
  beats: number[];
  markers: number[];
}

export interface PlannedSceneSegment {
  // 이 대목에 드는 비트 번호(0부터).
  readonly beats: readonly number[];
  readonly coordinate: string | undefined;
}

export interface SceneBreakPlan {
  readonly segments: readonly PlannedSceneSegment[];
}

// 시간대 낱말과 그 순서. 둘 다 시:분이 읽히지 않는 시각은 이 순서가 바뀔 때 전환으로 본다.
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

// 한 비트 안에서 시간이 흐른 시각(«오전부터 오후까지», «수업 동안», «경과»). 그 비트가 끝나면 전환이다.
const timeSpanPattern: RegExp = /까지|경과|동안|내내/;

// 날이 바뀌었다고 적힌 시각은 언제나 전환이다.
const dayChangePattern: RegExp =
  /다음\s*날|이튿날|며칠\s*(?:뒤|후)|\d+\s*일\s*(?:뒤|후)|일주일\s*(?:뒤|후)|다음\s*주/;

// 장소에서 같은 곳인지 가리는 데 쓰지 않는 낱말.
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

// 문자열에서 마지막으로 언급된 시간대. «오전부터 오후까지»는 끝난 때인 오후다.
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

// 장소 문자열을 같은 곳인지 가리는 낱말로 나눈다. 조사를 떼고 방향 낱말은 버린다.
export function placeWords(place: string): string[] {
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

// 좌표(장소·시각·break)가 있는 비트가 하나도 없으면 계획하지 않는다 — 모델 재량으로 남는다.
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

// 뼈대에 넘기는 사건 목록. 대목마다 ⟪대목 n⟫ 줄을 앞세운다. onlyBeats 를 주면 그 비트(0부터)만 싣고,
// 대목의 첫 비트가 빠진 대목(앞 호출이 쓰기 시작한 대목)에는 표식을 달지 않는다. 번호는 전체 기준이다.
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
  // 이 호출이 쓰는 비트 번호(0부터), 연속.
  readonly beats: readonly number[];
  // 이 호출 안에서 시작하는 대목의 번호(1부터). 그 표식을 옮겨 적어야 한다.
  readonly markers: readonly number[];
}

// NOTE: 42비트를 한 호출에 담으면 목표가 13k든 18k든 뼈대는 9~10k자에서 멈췄다(#115·#111 실측 4회).
// 호출 하나가 낼 수 있는 사건의 밀도에 상한이 있으므로, 뼈대 목표를 비트 수대로 나눠 한 호출의 몫이
// charsPerCall 을 넘지 않게 연속한 대목을 묶는다. 대목 하나의 몫이 그보다 크면 비트를 고르게 나눠
// 여러 호출로 이어 쓴다(15비트 대목이 한 호출에서 다시 69%에 멈춤). 목표가 없으면 한 호출이다.
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

// 호출이 자기 첫 대목의 표식을 빠뜨렸으면 앞에 붙인다. 호출의 시작 대목은 파이프라인이 안다.
export function ensureLeadingMarker(text: string, segmentNumber: number): string {
  const hasMarker: boolean = [...text.matchAll(SEGMENT_MARKER)].some(
    (match) => Number(match[1]) === segmentNumber,
  );
  return hasMarker ? text : `⟪대목 ${segmentNumber}⟫\n${text}`;
}

// 호출이 자기 몫이 아닌 ⟪대목 n⟫ 표식을 지어내면(대목 하나를 나눠 받은 호출이 제 조각에 다음 번호를
// 붙인 실측) 뒤 호출의 진짜 표식이 이미 본 번호로 무시돼 대목들이 마지막 대목에 뭉친다. 허용 번호 외의
// 표식은 지우고, 표식만 있던 줄은 없앤다.
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

// 본문에 없는 ⟪대목 n⟫ 표식의 수. 번호는 1부터.
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
  // 결과 본문의 대목 순서대로 그 좌표. --- 수 + 1 과 같다.
  readonly coordinates: readonly (string | undefined)[];
  // 결과 본문의 대목 순서대로, 그 대목에 든 비트 번호(0부터). 표식이 빠져 앞 대목에 붙은 계획 대목의
  // 비트는 그 앞 대목의 몫이다.
  readonly beats: readonly (readonly number[])[];
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
  const seen: Set<number> = new Set<number>();
  const coordinates: (string | undefined)[] = [];
  // 결과 대목마다 그 대목을 여는 계획 대목 번호(1부터).
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

  // 결과 대목 i는 자기를 연 계획 대목부터 다음 결과 대목이 열리기 전까지의 비트를 모두 가진다.
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

// 살붙임이 뼈대 조각의 --- 를 지우거나 더했을 때, 뼈대 조각의 대목마다 그 첫 문단과 가장 닮은
// 살붙임 문단 앞에 --- 를 다시 놓는다(#112). 바로 앞 문단이 이 대목을 더 닮았으면(전환 뒤 첫머리의
// 설정 문장) 한 문단 당긴다. 자리를 못 찾으면 undefined.
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

// NOTE: 미달 뼈대를 «더 쓰라»로만 다시 부르면 비트마다 고르게 조금씩 늘 뿐, 긴 설전이 두세 턴으로
// 끝나는 비트는 그대로였다(#115: 42비트가 비트당 228자로 수렴). 대목마다 둘 이상이 나오는 사건 수와
// 대사 수를 세어, 사건당 대사가 thinTurns 에 못 미치는 대목의 그런 사건들을 지목한다.
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

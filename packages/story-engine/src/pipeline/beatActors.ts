import {
escapeRegExp,
  formatSceneBeatCoordinates,
  sceneBeatCoordinateLabels,
  sceneBeatText,
  type CharacterCard,
  type SceneBeat,
type SceneBeatDetail,
} from '@storyboard/story-model';
import type { SceneBeatDirective, SceneBeatProposal, SceneBeatVerdict } from '@storyboard/story-ai';

const LOOKAHEAD_BEATS: number = 2;
const RECENT_PASSAGES_IN_FULL: number = 10;
const JUDGE_PREVIOUS_PASSAGES: number = 2;
const NOTE_SCORE_LIMIT: number = 3;
const NOTE_TTL_BEATS: number = 2;
const NOTE_LIMIT: number = 3;
const RETRY_SCORE_LIMIT: number = 3;

const INNER_LINE_PREFIX: string = '(속)';
const SCENE_BREAK_LINE: string = '---';

interface CatchphraseCount {
  readonly phrase: string;
  readonly count: number;
}

export interface ActedBeat {
  readonly number: number;
  readonly text: string;
  readonly cast: readonly string[];
  readonly place?: string;
  readonly time?: string;
  readonly isBreak: boolean;
}

function castNameResolver(characters: readonly CharacterCard[]): (ref: string) => string | undefined {
  const nameByRef: Map<string, string> = new Map<string, string>();

  for (const character of characters) {
    for (const ref of [character.id, character.name, ...(character.aliases ?? [])]) {
      nameByRef.set(ref, character.name);
    }
  }

  return (ref) => nameByRef.get(ref);
}

export function planActedBeats(
  beats: readonly SceneBeat[] | undefined,
  characters: readonly CharacterCard[],
): ActedBeat[] {
  const nameOf: (ref: string) => string | undefined = castNameResolver(characters);
  const everyone: string[] = characters.map((character) => character.name);
  let previousPlace: string | undefined;

  return (beats ?? []).map((beat, index) => {
    const detail: SceneBeatDetail | undefined = typeof beat === 'string' ? undefined : beat;
    const named: string[] = [...new Set((detail?.cast ?? []).flatMap((ref) => nameOf(ref) ?? []))];
    const place: string | undefined = detail?.place?.trim();
    const isBreak: boolean =
      index > 0 && place !== undefined && previousPlace !== undefined && place !== previousPlace;
    previousPlace = place ?? previousPlace;

    return {
      number: index + 1,
      text: sceneBeatText(beat),
      cast: named.length > 0 ? named : everyone,
      ...(place === undefined ? {} : { place }),
      ...(detail?.time === undefined ? {} : { time: detail.time }),
      isBreak,
    };
  });
}

export function toBeatDirective(
  beat: ActedBeat,
  sourceBeat: SceneBeat | undefined,
  castName: (ref: string) => string,
): SceneBeatDirective {
  const coordinates: string | undefined = sourceBeat === undefined ? undefined : formatSceneBeatCoordinates(sourceBeat, castName);

  return {
    number: beat.number,
    text: beat.text,
    ...(coordinates === undefined ? {} : { coordinates }),
  };
}

export function nextActedBeats(beats: readonly ActedBeat[], index: number): ActedBeat[] {
  return beats.slice(index + 1, index + 1 + LOOKAHEAD_BEATS);
}

export function observablePassage(passage: string): string {
  return passage
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(INNER_LINE_PREFIX))
    .join('\n')
    .trim();
}

function firstLine(passage: string): string {
  return observablePassage(passage).split('\n').find((line) => line.trim().length > 0) ?? '';
}

function recentInFull(
  beats: readonly ActedBeat[],
  passages: ReadonlyMap<number, string>,
  render: (passage: string) => string,
): string {
  const done: ActedBeat[] = beats.filter((beat) => passages.has(beat.number));
  const summarizedCount: number = Math.max(0, done.length - RECENT_PASSAGES_IN_FULL);

  return done
    .map((beat, index) => {
      const passage: string = passages.get(beat.number) as string;

      return index < summarizedCount
        ? `[대목 ${beat.number} — 요약] ${firstLine(passage).slice(0, 80)}`
        : `[대목 ${beat.number}]\n${render(passage)}`;
    })
    .join('\n\n');
}

export function witnessedPassages(
  beats: readonly ActedBeat[],
  passages: ReadonlyMap<number, string>,
  name: string,
): string {
  return recentInFull(
    beats.filter((beat) => beat.cast.includes(name)),
    passages,
    observablePassage,
  );
}

export function priorPassages(
  beats: readonly ActedBeat[],
  passages: ReadonlyMap<number, string>,
): string {
  return recentInFull(beats, passages, (passage) => passage);
}

export function previousPassagesForJudge(
  beats: readonly ActedBeat[],
  passages: ReadonlyMap<number, string>,
  beatNumber: number,
): string {
  return beats
    .filter((beat) => beat.number < beatNumber && passages.has(beat.number))
    .slice(-JUDGE_PREVIOUS_PASSAGES)
    .map((beat) => `[대목 ${beat.number}]\n${passages.get(beat.number) as string}`)
    .join('\n\n');
}

export function countCatchphrase(text: string, phrase: string): number {
  return (text.match(new RegExp(`(^|[^가-힣])${escapeRegExp(phrase)}`, 'g')) ?? []).length;
}

export function findBeatCatchphraseOveruse(input: {
  readonly beat: ActedBeat;
  readonly passage: string;
  readonly catchphrases: ReadonlyMap<string, readonly string[]>;
  readonly limit: number;
}): string[] {
  return input.beat.cast.flatMap((name) => {
    const counts: CatchphraseCount[] = (input.catchphrases.get(name) ?? [])
      .filter((phrase) => phrase.length > 0 && !input.beat.text.includes(phrase))
      .map((phrase) => ({ phrase, count: countCatchphrase(input.passage, phrase) }))
      .filter((entry) => entry.count > 0);
    const total: number = counts.reduce((sum, entry) => sum + entry.count, 0);

    return total > input.limit
      ? [
          `${name}의 입버릇이 이 대목에 ${total}회(상한 ${input.limit}회): ${counts
            .map((entry) => `"${entry.phrase}" ${entry.count}회`)
            .join(', ')} — 상한만큼만 남기고 지워라`,
        ]
      : [];
  });
}

function sentenceCount(line: string): number {
  return Math.max(1, (line.match(/[.!?…]+(?=\s|$)/g) ?? []).length);
}

export function findOverlongLines(
  proposal: SceneBeatProposal,
  maxChars: number,
  maxSentences: number,
): string[] {
  return proposal.options.flatMap((option, index) =>
    option.lines
      .filter((line) => line.length > maxChars || sentenceCount(line) > maxSentences)
      .map((line) => `선택지 ${index + 1}: "${line}" (${line.length}자)`),
  );
}

export interface BeatNote {
  readonly text: string;
  readonly beat: number;
}

const hasQuote = (text: string): boolean => /["“”'‘’「」]/.test(text);

export function addBeatNote(notes: readonly BeatNote[], beat: number, text: string): BeatNote[] {
  const trimmed: string = text.trim();

  if (trimmed.length === 0 || hasQuote(trimmed)) {
    return [...notes];
  }

  return [...notes.filter((note) => note.text !== trimmed), { text: trimmed, beat }].slice(
    -NOTE_LIMIT,
  );
}

export function liveBeatNotes(notes: readonly BeatNote[], beat: number): string[] {
  return notes.filter((note) => beat - note.beat <= NOTE_TTL_BEATS).map((note) => note.text);
}

export function shouldNoteScore(score: number): boolean {
  return score <= NOTE_SCORE_LIMIT;
}

export function beatRetryReasons(input: {
  readonly verdict: SceneBeatVerdict | undefined;
  readonly catchphraseOveruse: readonly string[];
}): string[] {
  const verdict: SceneBeatVerdict | undefined = input.verdict;

  return [
    ...(verdict?.scores ?? [])
      .filter((score) => score.score < RETRY_SCORE_LIMIT)
      .map(
        (score) =>
          `${score.name}: ${score.reason}${
            score.avoid.length > 0 && !hasQuote(score.avoid) ? ` → 피할 것: ${score.avoid}` : ''
          }`,
      ),
    ...(verdict !== undefined && !verdict.isBeatCovered ? [`지시 누락: ${verdict.beatMissing}`] : []),
    ...(verdict !== undefined && verdict.earlyMaterial.length > 0
      ? [`다음 대목 소재를 미리 씀: ${verdict.earlyMaterial}`]
      : []),
    ...input.catchphraseOveruse,
  ];
}

function coordinateMarker(beat: ActedBeat): string | undefined {
  const parts: string[] = [
    beat.time === undefined ? undefined : `${sceneBeatCoordinateLabels.time}: ${beat.time}`,
    beat.place === undefined ? undefined : `${sceneBeatCoordinateLabels.place}: ${beat.place}`,
    `있는 사람: ${beat.cast.join(', ')}`,
  ].filter((part): part is string => part !== undefined);

  return `⟪${parts.join(' / ')}⟫`;
}

export function assembleActedSkeleton(
  beats: readonly ActedBeat[],
  passages: ReadonlyMap<number, string>,
): string {
  const parts: string[] = [];

  beats.forEach((beat, index) => {
    if (index === 0 || beat.isBreak) {
      if (index > 0) {
        parts.push(SCENE_BREAK_LINE);
      }
      parts.push(coordinateMarker(beat) as string);
    }

    const passage: string = passages.get(beat.number)?.trim() ?? '';
    if (passage.length > 0) {
      parts.push(passage);
    }
  });

  return parts.join('\n\n');
}

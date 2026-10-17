import {
  formatSceneBeatCoordinates,
  sceneBeatCoordinateLabels,
  sceneBeatText,
  type CharacterCard,
  type SceneBeat,
} from '@storyboard/story-model';
import type { SceneBeatDirective, SceneBeatProposal, SceneBeatVerdict } from '@storyboard/story-ai';

// 배우 뼈대(actBeats)의 AI 없는 부분: 비트를 대목으로 세우고, 인물마다 자기가 본 대목만 골라 주고,
// 심판과 입버릇 계수의 반려 사유를 모으고, 끝난 대목들을 뼈대 한 편으로 엮는다. 값들은 2026-10
// guerrilla 01 실측 3회에서 정했다(.doc/experiments/actor-loop-2026-10-15).

// 모든 역할이 «아직 아니다»로 보는 뒤 대목 수. 하나만 주면 심판이 n+2 의 사건을 안 했다고 감점했다.
const LOOKAHEAD_BEATS = 2;
// 배우와 감독이 전문으로 보는 최근 대목 수. 그보다 앞은 첫 줄 요약으로 준다.
const RECENT_PASSAGES_IN_FULL = 10;
// 심판이 되풀이를 보는 직전 대목 수.
const JUDGE_PREVIOUS_PASSAGES = 2;
// 심판 지적을 다음 대목의 «피할 것»으로 남기는 점수 상한과, 그 메모가 사는 대목 수·개수.
const NOTE_SCORE_LIMIT = 3;
const NOTE_TTL_BEATS = 2;
const NOTE_LIMIT = 3;
// 이 점수 아래면 감독이 다시 엮는다.
const RETRY_SCORE_LIMIT = 3;

const INNER_LINE_PREFIX = '(속)';
const SCENE_BREAK_LINE = '---';

export interface ActedBeat {
  readonly number: number;
  readonly text: string;
  // 출연 인물의 이름. 비트가 출연을 적지 않았으면 씬의 모든 인물이다.
  readonly cast: readonly string[];
  readonly place?: string;
  readonly time?: string;
  // 앞 대목과 장소가 달라 --- 로 갈리는 대목.
  readonly isBreak: boolean;
}

function castNameResolver(characters: readonly CharacterCard[]): (ref: string) => string | undefined {
  const nameByRef = new Map<string, string>();

  for (const character of characters) {
    for (const ref of [character.id, character.name, ...(character.aliases ?? [])]) {
      nameByRef.set(ref, character.name);
    }
  }

  return (ref) => nameByRef.get(ref);
}

// NOTE: 비트를 대목으로 세운다. 출연은 카드와 맞는 것만 이름으로 옮기고(맞지 않는 출연은 입력 단계가
// 이미 경고했다), 전환은 장소가 바뀌는 자리에만 둔다 — 같은 자리에서 몇 분 뒤는 한 흐름이다.
export function planActedBeats(
  beats: readonly SceneBeat[] | undefined,
  characters: readonly CharacterCard[],
): ActedBeat[] {
  const nameOf = castNameResolver(characters);
  const everyone = characters.map((character) => character.name);
  let previousPlace: string | undefined;

  return (beats ?? []).map((beat, index) => {
    const detail = typeof beat === 'string' ? undefined : beat;
    const named = [...new Set((detail?.cast ?? []).flatMap((ref) => nameOf(ref) ?? []))];
    const place = detail?.place?.trim();
    const isBreak =
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
  const coordinates = sourceBeat === undefined ? undefined : formatSceneBeatCoordinates(sourceBeat, castName);

  return {
    number: beat.number,
    text: beat.text,
    ...(coordinates === undefined ? {} : { coordinates }),
  };
}

export function nextActedBeats(beats: readonly ActedBeat[], index: number): ActedBeat[] {
  return beats.slice(index + 1, index + 1 + LOOKAHEAD_BEATS);
}

// 시점 인물의 (속) 줄을 뺀 대목. 다른 배우는 이것만 본다.
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
  const done = beats.filter((beat) => passages.has(beat.number));
  const summarizedCount = Math.max(0, done.length - RECENT_PASSAGES_IN_FULL);

  return done
    .map((beat, index) => {
      const passage = passages.get(beat.number) as string;

      return index < summarizedCount
        ? `[대목 ${beat.number} — 요약] ${firstLine(passage).slice(0, 80)}`
        : `[대목 ${beat.number}]\n${render(passage)}`;
    })
    .join('\n\n');
}

// 이 인물이 출연한 대목의 겉으로 드러난 부분만. 자기가 없던 자리의 일은 끝까지 모른다.
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// NOTE: 어절 머리에서만 센다. 글자 포함으로 세면 «윗사람이 몸소»가 입버릇 «이 몸»으로 잡혀 멀쩡한
// 대목을 반려한다(실측 2차).
export function countCatchphrase(text: string, phrase: string): number {
  return (text.match(new RegExp(`(^|[^가-힣])${escapeRegExp(phrase)}`, 'g')) ?? []).length;
}

// 비트 텍스트가 그 입버릇을 직접 인용했으면 지시대로 쓴 것이므로 상한에서 뺀다(실측 3차: 지시가
// 두 번 요구하는 호칭을 상한이 막아 감독이 돌려 썼다).
export function findBeatCatchphraseOveruse(input: {
  readonly beat: ActedBeat;
  readonly passage: string;
  readonly catchphrases: ReadonlyMap<string, readonly string[]>;
  readonly limit: number;
}): string[] {
  return input.beat.cast.flatMap((name) => {
    const counts = (input.catchphrases.get(name) ?? [])
      .filter((phrase) => phrase.length > 0 && !input.beat.text.includes(phrase))
      .map((phrase) => ({ phrase, count: countCatchphrase(input.passage, phrase) }))
      .filter((entry) => entry.count > 0);
    const total = counts.reduce((sum, entry) => sum + entry.count, 0);

    return total > input.limit
      ? [
          `${name}의 입버릇이 이 대목에 ${total}회(상한 ${input.limit}회): ${counts
            .map((entry) => `"${entry.phrase}" ${entry.count}회`)
            .join(', ')} — 상한만큼만 남기고 지워라`,
        ]
      : [];
  });
}

// 한국어 어미로 세면 «변하지»의 «지»까지 문장으로 잡힌다. 문장 부호로만 세고 최소 1로 본다.
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

// NOTE: 심판의 «피할 것»만 남기고 따옴표가 든 것은 버린다. 1차 실측에서 대사 문구가 메모로 넘어가자
// 배우가 그 문구를 받아쓰며 틱이 증폭됐다. 같은 메모는 한 번만, 최근 것부터 셋까지.
export function addBeatNote(notes: readonly BeatNote[], beat: number, text: string): BeatNote[] {
  const trimmed = text.trim();

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

// 감독이 다시 엮어야 할 이유. 낮은 점수·지시 누락·뒤 대목 선점은 심판이, 입버릇 초과는 계수가 댄다.
export function beatRetryReasons(input: {
  readonly verdict: SceneBeatVerdict | undefined;
  readonly catchphraseOveruse: readonly string[];
}): string[] {
  const verdict = input.verdict;

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
  const parts = [
    beat.time === undefined ? undefined : `${sceneBeatCoordinateLabels.time}: ${beat.time}`,
    beat.place === undefined ? undefined : `${sceneBeatCoordinateLabels.place}: ${beat.place}`,
    `있는 사람: ${beat.cast.join(', ')}`,
  ].filter((part): part is string => part !== undefined);

  return `⟪${parts.join(' / ')}⟫`;
}

// 뼈대 한 편. 장면 첫머리와 --- 다음에 ⟪⟫ 표식을 두어, 뼈대 단계와 같은 장부 추출을 지난다.
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

    const passage = passages.get(beat.number)?.trim() ?? '';
    if (passage.length > 0) {
      parts.push(passage);
    }
  });

  return parts.join('\n\n');
}

import { characterMatchTokens, findForeignScriptSpans } from '@storyboard/story-model';
import type { CharacterCard, ForeignScriptSpan } from '@storyboard/story-model';

import { pipelineDefaults } from '#engine/pipeline/pipelineDefaults';
import { resolveSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import type {
  ResolvedSceneGenerationTuning,
  SceneGenerationTuningInput,
  SectionViolationKind,
} from '#engine/pipeline/sceneGenerationTuning';
import { SCENE_BREAK_LINE } from '#engine/pipeline/sectionPlanning';
import { countCatchphrase, type CatchphraseCount } from '#engine/pipeline/catchphrases';

interface LineSpan {
  line: string;
  skeletonStart: number;
  skeletonEnd: number;
  expandedStart: number;
  expandedEnd: number;
}

function detectCanonicalCast(text: string, characters: readonly CharacterCard[]): Set<string> {
  const canonical: Set<string> = new Set<string>();

  for (const card of characters) {
    if (characterMatchTokens(card).some((token) => text.includes(token))) {
      canonical.add(card.name);
    }
  }

  return canonical;
}

export interface SectionViolation {
  readonly kind: SectionViolationKind;
  readonly detail: string;
}

const spaceNouns: readonly string[] = [
  '서재',
  '침실',
  '안방',
  '작은방',
  '거실',
  '부엌',
  '주방',
  '식당',
  '욕실',
  '화장실',
  '현관',
  '베란다',
  '발코니',
  '테라스',
  '옥상',
  '마당',
  '정원',
  '복도',
  '계단',
  '다락',
  '창고',
  '지하',
  '차고',
  '엘리베이터',
  '사무실',
  '교실',
  '카페',
  '편의점',
  '골목',
];

const recapPhrasePattern: RegExp = /아까/g;

export function countRecapPhrases(text: string): number {
  return [...text.matchAll(recapPhrasePattern)].length;
}

export function findPlacesOffCoordinates(input: {
  readonly expanded: string;
  readonly section: string;
  readonly sectionPlaces: readonly string[];
  readonly backgroundFacts?: readonly string[];
}): string[] {
  if (input.sectionPlaces.length === 0) {
    return [];
  }

  const allowed: string = [
    input.section,
    ...input.sectionPlaces,
    ...(input.backgroundFacts ?? []),
  ].join('\n');

  return spaceNouns.filter((noun) => input.expanded.includes(noun) && !allowed.includes(noun));
}

const quotedDialoguePatterns: Map<number, RegExp> = new Map<number, RegExp>();

export function quotedDialoguePatternFor(minimumQuotedLength: number): RegExp {
  const cached: RegExp | undefined = quotedDialoguePatterns.get(minimumQuotedLength);
  if (cached) {
    return cached;
  }

  const pattern: RegExp = new RegExp(`[“"]([^”"\\n]{${minimumQuotedLength},})[”"]`, 'g');
  quotedDialoguePatterns.set(minimumQuotedLength, pattern);
  return pattern;
}

export const quotedDialoguePattern: RegExp = quotedDialoguePatternFor(
  pipelineDefaults.dialogue.minimumQuotedLength,
);

export const DIALOGUE_PRESERVED_RATIO: number = pipelineDefaults.dialogue.preservedRatio;

function isDialoguePreserved(
  line: string,
  candidates: readonly string[],
  preservedRatio: number,
  splitLimit: number,
): boolean {
  for (let start: number = 0; start < candidates.length; start += 1) {
    let joined: string = '';

    for (
      let width: number = 0;
      width < splitLimit && start + width < candidates.length;
      width += 1
    ) {
      joined =
        width === 0 ? (candidates[start] as string) : `${joined} ${candidates[start + width]}`;

      if (similarityRatio(line, joined) >= preservedRatio) {
        return true;
      }
    }
  }

  return false;
}

function similarityRatio(left: string, right: string): number {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 1 : 0;
  }

  return (2 * matchedLength(left, right)) / (left.length + right.length);
}

function matchedLength(left: string, right: string): number {
  const previous: number[] = new Array<number>(right.length + 1).fill(0);
  const current: number[] = new Array<number>(right.length + 1).fill(0);

  for (let i: number = 1; i <= left.length; i += 1) {
    for (let j: number = 1; j <= right.length; j += 1) {
      current[j] =
        left[i - 1] === right[j - 1]
          ? (previous[j - 1] as number) + 1
          : Math.max(previous[j] as number, current[j - 1] as number);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] as number;
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s/g, '');
}

function repeatedFromPrevious(
  previousSection: string | undefined,
  expanded: string,
  window: number,
): number {
  if (previousSection === undefined) {
    return 0;
  }

  const previous: string = withoutWhitespace(previousSection);
  const written: string = withoutWhitespace(expanded);
  let repeated: number = 0;

  for (let start: number = 0; start + window <= previous.length; start += window) {
    if (written.includes(previous.slice(start, start + window))) {
      repeated += window;
    }
  }

  return repeated;
}

function dialogueLinesOf(text: string, tuning: ResolvedSceneGenerationTuning): string[] {
  return [...text.matchAll(quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength))]
    .map((match) => (match[1] ?? '').replace(/\s/g, ''))
    .filter((line) => line.length >= tuning.dialogueMinimumLineLength);
}

export function findRepeatedDialogueRunBetween(
  first: string,
  second: string,
  tuning?: SceneGenerationTuningInput,
): number {
  const resolved: ResolvedSceneGenerationTuning = resolveSceneGenerationTuning(tuning);
  const left: string[] = dialogueLinesOf(first, resolved);
  const right: string[] = dialogueLinesOf(second, resolved);
  let longest: number = 0;

  for (let i: number = 0; i < left.length; i += 1) {
    for (let j: number = 0; j < right.length; j += 1) {
      let run: number = 0;

      while (i + run < left.length && j + run < right.length && left[i + run] === right[j + run]) {
        run += 1;
      }

      longest = Math.max(longest, run);
    }
  }

  return longest;
}

export function findRepeatedDialogueRun(text: string, tuning?: SceneGenerationTuningInput): number {
  const lines: string[] = dialogueLinesOf(text, resolveSceneGenerationTuning(tuning));
  let longest: number = 0;

  for (let first: number = 0; first < lines.length; first += 1) {
    for (let second: number = first + 1; second < lines.length; second += 1) {
      let run: number = 0;

      while (
        second + run < lines.length &&
        lines[first + run] !== undefined &&
        lines[first + run] === lines[second + run]
      ) {
        run += 1;
      }

      longest = Math.max(longest, run);
    }
  }

  return longest;
}

export function validateSceneSkeleton(
  skeleton: string,
  targetLength?: number,
  tuning?: SceneGenerationTuningInput,
): SectionViolation[] {
  const resolved: ResolvedSceneGenerationTuning = resolveSceneGenerationTuning(tuning);
  const violations: SectionViolation[] = [];
  const run: number = findRepeatedDialogueRun(skeleton, tuning);

  if (run >= resolved.dialogueRepeatedRunLimit) {
    violations.push({
      kind: 'repeats-previous',
      detail: `같은 대사 ${run}개가 순서까지 같게 두 번 나옵니다. 각 사건은 한 번만 쓰세요`,
    });
  }

  if (
    targetLength !== undefined &&
    skeleton.length < targetLength * resolved.skeletonMinimumLengthRatio
  ) {
    violations.push({
      kind: 'too-short',
      detail: `뼈대가 목표 ${targetLength.toLocaleString()}자의 ${Math.round(resolved.skeletonMinimumLengthRatio * 100)}%에 못 미칩니다 (${skeleton.length.toLocaleString()}자, ${Math.round((skeleton.length / targetLength) * 100)}%). 묘사를 더하지 말고 사건을 단계로 쪼개고 주고받는 말을 여러 턴으로 늘리세요`,
    });
  }

  return violations;
}

function countBreakLines(text: string): number {
  return text.split('\n').filter((line) => line.trim() === SCENE_BREAK_LINE).length;
}

interface ExpandedSectionInput {
  readonly skeleton: string;
  readonly section: string;
  readonly expanded: string;
  readonly characters: readonly CharacterCard[];
  readonly targetLength: number;
  readonly previousSection?: string;
  readonly sectionPlaces?: readonly string[];
  readonly backgroundFacts?: readonly string[];
  readonly dialoguePreservedRatio?: number;
  readonly paddingParagraphRatio?: number;
  readonly tuning?: SceneGenerationTuningInput;
}

interface SectionCheckContext {
  readonly tuning: ResolvedSceneGenerationTuning;
  readonly preservedRatio: number;
  readonly paddingRatio: number;
}

type SectionCheck = (
  input: ExpandedSectionInput,
  context: SectionCheckContext,
) => SectionViolation[];

function resolveSectionCheckContext(input: ExpandedSectionInput): SectionCheckContext {
  const tuning: ResolvedSceneGenerationTuning = resolveSceneGenerationTuning(input.tuning);

  return {
    tuning,
    preservedRatio: input.dialoguePreservedRatio ?? tuning.dialoguePreservedRatio,
    paddingRatio: input.paddingParagraphRatio ?? tuning.paddingParagraphRatio,
  };
}

function checkAddedCast(input: ExpandedSectionInput): SectionViolation[] {
  const inSkeleton: Set<string> = detectCanonicalCast(input.skeleton, input.characters);
  const added: string[] = [...detectCanonicalCast(input.expanded, input.characters)].filter(
    (name) => !inSkeleton.has(name),
  );

  if (added.length === 0) {
    return [];
  }

  return [
    {
      kind: 'cast',
      detail: `뼈대에 없는 인물이 등장합니다 (${added.join(', ')})`,
    },
  ];
}

function checkOffCoordinatePlaces(input: ExpandedSectionInput): SectionViolation[] {
  const offPlaces: string[] = findPlacesOffCoordinates({
    expanded: input.expanded,
    section: input.section,
    sectionPlaces: input.sectionPlaces ?? [],
    ...(input.backgroundFacts === undefined ? {} : { backgroundFacts: input.backgroundFacts }),
  });
  if (offPlaces.length === 0) {
    return [];
  }

  return [
    {
      kind: 'place',
      detail: `좌표와 공간 사실에 없는 공간을 세웠습니다 (${offPlaces.join(', ')}). 이번 구간의 비트 좌표가 가리키는 자리 안에서 쓰세요`,
    },
  ];
}

function checkForeignScript(input: ExpandedSectionInput): SectionViolation[] {
  const foreign: ForeignScriptSpan[] = findForeignScriptSpans(input.expanded);
  if (foreign.length === 0) {
    return [];
  }

  return [
    {
      kind: 'foreign-script',
      detail: `외국 문자가 섞였습니다 (${foreign.map((span) => `"${span.text}"`).join(', ')})`,
    },
  ];
}

function checkLostDialogue(
  input: ExpandedSectionInput,
  context: SectionCheckContext,
): SectionViolation[] {
  const { tuning, preservedRatio }: SectionCheckContext = context;
  const quoted: RegExp = quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength);
  const expandedLines: string[] = [...input.expanded.matchAll(quoted)].map((match) =>
    (match[1] ?? '').trim(),
  );
  const lost: string[] = [...input.section.matchAll(quoted)]
    .map((match) => (match[1] ?? '').trim())
    .filter(
      (line) =>
        line.length >= tuning.dialogueMinimumLineLength &&
        !isDialoguePreserved(line, expandedLines, preservedRatio, tuning.dialogueSplitLimit),
    );

  if (lost.length === 0) {
    return [];
  }

  return [
    {
      kind: 'lost-dialogue',
      detail: `뼈대의 대사가 사라졌습니다 ("${lost[0] as string}"${lost.length > 1 ? ` 외 ${lost.length - 1}건` : ''})`,
    },
  ];
}

function checkSceneBreakCount(input: ExpandedSectionInput): SectionViolation[] {
  const skeletonBreaks: number = countBreakLines(input.section);
  const expandedBreaks: number = countBreakLines(input.expanded);
  if (skeletonBreaks === expandedBreaks) {
    return [];
  }

  return [
    {
      kind: 'scene-breaks',
      detail: `뼈대 조각의 장면 전환(---) ${skeletonBreaks}개가 ${expandedBreaks}개가 됐습니다. 단독 줄 --- 를 뼈대와 같은 자리에 같은 수만큼 두세요`,
    },
  ];
}

function checkSectionLength(
  input: ExpandedSectionInput,
  context: SectionCheckContext,
): SectionViolation[] {
  const isTooShort: boolean =
    input.expanded.length < input.targetLength * context.tuning.sectionMinimumLengthRatio;
  if (!isTooShort) {
    return [];
  }

  return [
    {
      kind: 'too-short',
      detail: `목표 ${input.targetLength.toLocaleString()}자에 크게 못 미칩니다 (${input.expanded.length.toLocaleString()}자). 사건 사이에 시점 인물의 반응·해석과 행동을 서술자의 목소리로 더 쓰되 이미 쓴 문장을 되풀이하지는 마세요`,
    },
  ];
}

function checkRunAheadDialogue(
  input: ExpandedSectionInput,
  context: SectionCheckContext,
): SectionViolation[] {
  const ranAhead: string[] = findRunAheadDialogue(
    input.skeleton,
    input.section,
    input.expanded,
    context.tuning,
  );
  if (ranAhead.length === 0) {
    return [];
  }

  return [
    {
      kind: 'runs-ahead',
      detail: `다음 구간의 대사를 미리 썼습니다 ("${ranAhead[0] as string}"${ranAhead.length > 1 ? ` 외 ${ranAhead.length - 1}건` : ''}). [이번 구간]의 마지막 문장에서 멈추세요`,
    },
  ];
}

function checkRepeatedPreviousText(
  input: ExpandedSectionInput,
  context: SectionCheckContext,
): SectionViolation[] {
  const repeated: number = repeatedFromPrevious(
    input.previousSection,
    input.expanded,
    context.tuning.sectionRepeatedRunWindow,
  );
  const isRepeated: boolean = repeated >= context.tuning.sectionRepeatedRunLimit;
  if (!isRepeated) {
    return [];
  }

  return [
    {
      kind: 'repeats-previous',
      detail: `직전 구간을 약 ${repeated.toLocaleString()}자 다시 썼습니다. 이번 구간의 사건만 쓰세요`,
    },
  ];
}

function checkRepeatedPreviousDialogue(
  input: ExpandedSectionInput,
  context: SectionCheckContext,
): SectionViolation[] {
  const repeatedDialogue: number =
    input.previousSection === undefined
      ? 0
      : findRepeatedDialogueRunBetween(input.previousSection, input.expanded, input.tuning);

  const isRepeated: boolean = repeatedDialogue >= context.tuning.dialogueRepeatedRunLimit;
  if (!isRepeated) {
    return [];
  }

  return [
    {
      kind: 'repeats-previous',
      detail: `직전 구간의 대사 ${repeatedDialogue}개를 순서까지 같게 다시 썼습니다. 이번 구간의 사건만 쓰세요`,
    },
  ];
}

function checkPaddingRepetition(
  input: ExpandedSectionInput,
  context: SectionCheckContext,
): SectionViolation[] {
  const padding: string | undefined = findPaddingRepetition(
    input.section,
    input.expanded,
    input.previousSection,
    context.paddingRatio,
    context.tuning,
  );

  return padding === undefined ? [] : [{ kind: 'repetition', detail: padding }];
}

const sectionChecks: readonly SectionCheck[] = [
  checkAddedCast,
  checkOffCoordinatePlaces,
  checkForeignScript,
  checkLostDialogue,
  checkSceneBreakCount,
  checkSectionLength,
  checkRunAheadDialogue,
  checkRepeatedPreviousText,
  checkRepeatedPreviousDialogue,
  checkPaddingRepetition,
];

export function validateExpandedSection(input: ExpandedSectionInput): SectionViolation[] {
  const context: SectionCheckContext = resolveSectionCheckContext(input);

  return sectionChecks.flatMap((check: SectionCheck): SectionViolation[] => check(input, context));
}

export const PADDING_PARAGRAPH_RATIO: number = pipelineDefaults.padding.paragraphRatio;

function findPaddingRepetition(
  section: string,
  expanded: string,
  previousSection: string | undefined,
  paddingRatio: number,
  tuning: ResolvedSceneGenerationTuning,
): string | undefined {
  const repeatedLine: string | undefined = findRepeatedDialogueLine(
    section,
    expanded,
    previousSection,
    tuning,
  );
  if (repeatedLine !== undefined) {
    return `같은 대사를 두 번 썼습니다 ("${repeatedLine}"). 분량이 모자라도 이미 쓴 대사를 되풀이하지 마세요`;
  }

  const repeatedParagraph: string | undefined = findNearDuplicateParagraph(
    expanded,
    previousSection,
    paddingRatio,
    tuning,
  );
  if (repeatedParagraph !== undefined) {
    return `같은 내용의 문단을 되풀이했습니다 ("${repeatedParagraph.slice(0, 30)}…"). 채울 재료가 없으면 짧게 끝내세요`;
  }

  return undefined;
}

function countOccurrences(lines: readonly string[]): Map<string, number> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  return counts;
}

function findRepeatedDialogueLine(
  section: string,
  expanded: string,
  previousSection: string | undefined,
  tuning: ResolvedSceneGenerationTuning,
): string | undefined {
  const allowed: Map<string, number> = countOccurrences(dialogueLinesOf(section, tuning));
  const written: string[] = dialogueLinesOf(expanded, tuning);
  const writtenCounts: Map<string, number> = countOccurrences(written);
  const previous: Set<string> = new Set(
    previousSection === undefined ? [] : dialogueLinesOf(previousSection, tuning),
  );

  for (const line of written) {
    const count: number = writtenCounts.get(line) ?? 0;
    const permitted: number = allowed.get(line) ?? 0;

    if (count > Math.max(1, permitted) || (permitted === 0 && previous.has(line))) {
      return line;
    }
  }

  return undefined;
}

function narrationParagraphsOf(text: string, tuning: ResolvedSceneGenerationTuning): string[] {
  const quoted: RegExp = quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength);

  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(quoted, '').replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length >= tuning.paddingParagraphMinimumLength);
}

function findNearDuplicateParagraph(
  expanded: string,
  previousSection: string | undefined,
  paddingRatio: number,
  tuning: ResolvedSceneGenerationTuning,
): string | undefined {
  const paragraphs: string[] = narrationParagraphsOf(expanded, tuning);
  const earlier: string[] =
    previousSection === undefined ? [] : narrationParagraphsOf(previousSection, tuning);

  for (let index: number = 0; index < paragraphs.length; index += 1) {
    const paragraph: string = paragraphs[index] as string;
    const candidates: string[] = [...earlier, ...paragraphs.slice(0, index)];

    if (candidates.some((other) => similarityRatio(paragraph, other) >= paddingRatio)) {
      return paragraph;
    }
  }

  return undefined;
}

function countDialogueTurns(text: string, tuning: ResolvedSceneGenerationTuning): number {
  return [...text.matchAll(quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength))].length;
}

export function validatePolishedSkeleton(input: {
  readonly skeleton: string;
  readonly polished: string;
  readonly characters: readonly CharacterCard[];
  readonly lengthLimit: number;
  readonly tuning?: SceneGenerationTuningInput;
}): SectionViolation[] {
  const resolved: ResolvedSceneGenerationTuning = resolveSceneGenerationTuning(input.tuning);
  const violations: SectionViolation[] = [];

  const before: Set<string> = detectCanonicalCast(input.skeleton, input.characters);
  const added: string[] = [...detectCanonicalCast(input.polished, input.characters)].filter(
    (name) => !before.has(name),
  );

  if (added.length > 0) {
    violations.push({
      kind: 'cast',
      detail: `뼈대에 없는 인물이 등장합니다 (${added.join(', ')})`,
    });
  }

  const foreign: ForeignScriptSpan[] = findForeignScriptSpans(input.polished);
  if (foreign.length > 0) {
    violations.push({
      kind: 'foreign-script',
      detail: `외국 문자가 섞였습니다 (${foreign.map((span) => `"${span.text}"`).join(', ')})`,
    });
  }

  const turnDelta: number =
    countDialogueTurns(input.polished, resolved) - countDialogueTurns(input.skeleton, resolved);
  if (turnDelta !== 0) {
    violations.push({
      kind: 'dialogue-count',
      detail:
        turnDelta > 0
          ? `뼈대에 없던 대사가 ${turnDelta}개 늘었습니다`
          : `뼈대의 대사 ${-turnDelta}개가 사라졌습니다`,
    });
  }

  if (input.polished.length > input.lengthLimit) {
    violations.push({
      kind: 'too-long',
      detail: `뼈대의 두 배를 넘겼습니다 (${input.polished.length.toLocaleString()}자)`,
    });
  }

  return violations;
}

export function findPolishedLineViolations(input: {
  readonly skeleton: string;
  readonly lines: ReadonlyMap<number, string>;
  readonly characters: readonly CharacterCard[];
  readonly tuning?: SceneGenerationTuningInput;
}): Map<number, SectionViolation[]> {
  const resolved: ResolvedSceneGenerationTuning = resolveSceneGenerationTuning(input.tuning);
  const skeletonCast: Set<string> = detectCanonicalCast(input.skeleton, input.characters);
  const violationsByIndex: Map<number, SectionViolation[]> = new Map<number, SectionViolation[]>();

  for (const [index, line] of input.lines) {
    const violations: SectionViolation[] = [];

    if (countDialogueTurns(`“${line}”`, resolved) !== 1) {
      violations.push({
        kind: 'dialogue-count',
        detail: `⟨${index}⟩이 ${resolved.dialogueMinimumQuotedLength}자보다 짧아져 대사로 세어지지 않습니다`,
      });
    }

    const added: string[] = [...detectCanonicalCast(line, input.characters)].filter(
      (name) => !skeletonCast.has(name),
    );
    if (added.length > 0) {
      violations.push({
        kind: 'cast',
        detail: `⟨${index}⟩에 뼈대에 없는 인물이 나옵니다 (${added.join(', ')})`,
      });
    }

    const foreign: ForeignScriptSpan[] = findForeignScriptSpans(line);
    if (foreign.length > 0) {
      violations.push({
        kind: 'foreign-script',
        detail: `⟨${index}⟩에 외국 문자가 섞였습니다 (${foreign.map((span) => `"${span.text}"`).join(', ')})`,
      });
    }

    if (violations.length > 0) {
      violationsByIndex.set(index, violations);
    }
  }

  return violationsByIndex;
}

export function findCatchphraseOveruse(input: {
  readonly text: string;
  readonly characters: readonly CharacterCard[];
  readonly beatCount: number;
  readonly tuning?: SceneGenerationTuningInput;
}): string[] {
  if (input.beatCount === 0) {
    return [];
  }

  const limit: number =
    input.beatCount * resolveSceneGenerationTuning(input.tuning).catchphrasePerBeatLimit;
  const warnings: string[] = [];

  for (const character of input.characters) {
    const counts: CatchphraseCount[] = (character.catchphrases ?? [])
      .map((phrase) => ({ phrase, count: countCatchphrase(input.text, phrase) }))
      .filter((entry) => entry.phrase.length > 0 && entry.count > 0);
    const total: number = counts.reduce((sum, entry) => sum + entry.count, 0);

    if (total > limit) {
      warnings.push(
        `${character.name}의 입버릇이 ${total}회 나옵니다 (비트 ${input.beatCount}개, 상한 ${limit}회): ${counts.map((entry) => `"${entry.phrase}" ${entry.count}회`).join(', ')}`,
      );
    }
  }

  return warnings;
}

export interface ThinExpansionSpot {
  readonly line: string;
  readonly added: number;
}

const thinSpotLimit: number = 3;

export function findThinExpansionSpots(
  section: string,
  expanded: string,
  minimumQuotedLength: number,
): ThinExpansionSpot[] {
  const found: LineSpan[] = [];
  let searchFrom: number = 0;

  for (const match of section.matchAll(quotedDialoguePatternFor(minimumQuotedLength))) {
    const line: string = (match[1] ?? '').trim();
    const at: number = expanded.indexOf(line, searchFrom);
    if (line.length === 0 || at < 0 || match.index === undefined) {
      continue;
    }

    found.push({
      line,
      skeletonStart: match.index,
      skeletonEnd: match.index + match[0].length,
      expandedStart: at,
      expandedEnd: at + line.length,
    });
    searchFrom = at + line.length;
  }

  return found
    .slice(0, -1)
    .map((current, index) => {
      const next: LineSpan = found[index + 1] ?? current;
      const skeletonGap: number = next.skeletonStart - current.skeletonEnd;
      const expandedGap: number = next.expandedStart - current.expandedEnd;
      return { line: current.line, added: expandedGap - skeletonGap };
    })
    .sort((left, right) => left.added - right.added)
    .slice(0, thinSpotLimit);
}

export function describeThinExpansionSpots(
  spots: readonly ThinExpansionSpot[],
): string | undefined {
  if (spots.length === 0) {
    return undefined;
  }

  const quoted: string = spots
    .map((spot) => `“${spot.line.length > 20 ? `${spot.line.slice(0, 20)}…` : spot.line}”`)
    .join(', ');
  return `특히 대사 ${quoted} 다음에는 서술이 거의 붙지 않았습니다. 그 자리부터 시점 인물의 반응·해석·행동을 펼치세요`;
}

export function findRunAheadDialogue(
  skeleton: string,
  section: string,
  expanded: string,
  tuning: ResolvedSceneGenerationTuning,
): string[] {
  const paragraphs: string[] = section.trim().split(/\n\s*\n+/);
  const sectionStart: number = skeleton.indexOf(paragraphs[0] ?? '');
  const lastParagraph: string = paragraphs.at(-1) ?? '';
  const lastStart: number = sectionStart < 0 ? -1 : skeleton.indexOf(lastParagraph, sectionStart);
  if (lastStart < 0) {
    return [];
  }

  const quoted: RegExp = quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength);
  const linesOf = (text: string): string[] =>
    [...text.matchAll(quoted)]
      .map((match) => (match[1] ?? '').trim())
      .filter((line) => line.length >= tuning.dialogueMinimumLineLength);
  const own: Set<string> = new Set(linesOf(section));
  const later: string[] = linesOf(skeleton.slice(lastStart + lastParagraph.length)).filter(
    (line) => !own.has(line),
  );

  return [...new Set(later.filter((line) => expanded.includes(line)))];
}

export function trimRunAheadDialogue(expanded: string, lines: readonly string[]): string {
  const first: number = Math.min(
    ...lines.map((line) => expanded.indexOf(line)).filter((index) => index >= 0),
  );
  if (!Number.isFinite(first)) {
    return expanded;
  }

  const cut: number = expanded.lastIndexOf('\n\n', first);
  return cut <= 0 ? expanded : expanded.slice(0, cut).trimEnd();
}

import { characterMatchTokens } from '@storyboard/story-format';
import type { CharacterCard } from '@storyboard/story-format';
import { findForeignScriptSpans } from '@storyboard/story-format';
import { integerSettingDefault } from '@storyboard/story-ai';

import { pipelineDefaults } from './pipelineDefaults';
import { resolveSceneGenerationTuning } from './sceneGenerationTuning';
import type {
  ResolvedSceneGenerationTuning,
  SceneGenerationTuning,
  SectionViolationKind,
} from './sceneGenerationTuning';

// 한 번의 살붙임 호출이 낼 수 있는 최대 분량. 출력 한도에 걸려 뒷부분이 잘리는 것을 막는다.
// 창작자가 고칠 수 있는 값이므로 기본값은 설정 카탈로그가 갖는다.
export const SECTION_OUTPUT_LIMIT = integerSettingDefault('generation.section.outputLimit');

// NOTE: 뼈대를 문단 경계에서 끊어 구간으로 나눈다. 구간 수는 목표 분량이 상한을 넘지 않는 최소값이라,
// 짧은 씬은 사실상 단일 패스로 돌고 긴 씬만 쪼개진다.
export function planSectionCount(targetLength: number, outputLimit = SECTION_OUTPUT_LIMIT): number {
  if (targetLength <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(targetLength / outputLimit));
}

// NOTE: 절단은 뜻이 끊기는 자리에서 해야 한다. 뼈대가 남긴 --- 장면 전환이 예산 근처에 있으면
// 그 자리를 우선 쓰고, 없을 때만 문단 경계로 내려간다. 결투 한복판에서 구간이 갈리는 일을 막는다.
const SCENE_BREAK_LINE = '---';

interface SkeletonUnit {
  readonly text: string;
  readonly endsScene: boolean;
}

function splitIntoUnits(skeleton: string): SkeletonUnit[] {
  return skeleton
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => ({ text: block, endsScene: block === SCENE_BREAK_LINE }));
}

export function splitSkeletonIntoSections(skeleton: string, sectionCount: number): string[] {
  const trimmed = skeleton.trim();

  if (sectionCount <= 1) {
    return [trimmed];
  }

  const units = splitIntoUnits(trimmed);
  const splittable = units.filter((unit) => !unit.endsScene);

  if (splittable.length <= 1) {
    return [trimmed];
  }

  const budget = trimmed.length / sectionCount;
  const sections: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  let closedSections = 0;

  units.forEach((unit, index) => {
    current.push(unit.text);
    currentLength += unit.text.length;

    const remainingUnits = units.slice(index + 1).filter((rest) => !rest.endsScene).length;
    const remainingSections = sectionCount - closedSections - 1;
    if (remainingSections <= 0 || remainingUnits === 0) {
      return;
    }

    // 장면 전환 자리는 예산의 절반만 채워도 자른다. 그 자리가 가장 자연스러운 절단점이기 때문이다.
    const atSceneBreak = unit.endsScene && currentLength >= budget / 2;
    const filled = currentLength >= budget;
    const mustClose = remainingUnits === remainingSections;

    if (atSceneBreak || filled || mustClose) {
      sections.push(current.join('\n\n'));
      current = [];
      currentLength = 0;
      closedSections += 1;
    }
  });

  if (current.length > 0) {
    sections.push(current.join('\n\n'));
  }

  return sections;
}

// NOTE: 뼈대는 문단 경계에서 끊기므로 조각 길이가 고르지 않고, 마지막 조각이 가장 얇기 쉽다. 예산을
// 균등하게 나누면 얇은 조각이 남는 재료 없이 큰 분량을 요구받아 앞 구간을 되풀이한다. 조각 길이에
// 비례해 나누되 한 호출의 출력 한도는 넘기지 않는다.
export function planSectionTargetLengths(
  sections: readonly string[],
  totalTarget: number,
  outputLimit = SECTION_OUTPUT_LIMIT,
): number[] {
  const weights = sections.map((section) => section.replace(/\s/g, '').length);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight === 0) {
    return sections.map(() => Math.max(1, Math.round(totalTarget / sections.length)));
  }

  return weights.map((weight) =>
    Math.min(outputLimit, Math.max(1, Math.round((totalTarget * weight) / totalWeight))),
  );
}

// NOTE: detectCharactersInText는 매칭된 토큰을 그대로 돌려주므로, 별칭이나 게임명으로 부른 인물이
// 본명으로 부른 같은 인물과 다른 사람으로 잡힌다. 카드 이름으로 되돌려 세야 오탐이 없다.
function detectCanonicalCast(text: string, characters: readonly CharacterCard[]): Set<string> {
  const canonical = new Set<string>();

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

// NOTE: 따옴표 최소 길이가 손잡이라 정규식을 미리 컴파일해 둘 수 없다. dialogueLinesOf 가 O(n²)
// 비교 안에서 불리므로 호출마다 새로 만들면 실측 가능한 성능 저하가 된다 — 길이별로 하나만 만든다.
const quotedDialoguePatterns = new Map<number, RegExp>();

export function quotedDialoguePatternFor(minimumQuotedLength: number): RegExp {
  const cached = quotedDialoguePatterns.get(minimumQuotedLength);
  if (cached) {
    return cached;
  }

  const pattern = new RegExp(`[“"]([^”"\\n]{${minimumQuotedLength},})[”"]`, 'g');
  quotedDialoguePatterns.set(minimumQuotedLength, pattern);
  return pattern;
}

/** @deprecated 손잡이를 받는 quotedDialoguePatternFor 를 쓴다. */
export const quotedDialoguePattern = quotedDialoguePatternFor(
  pipelineDefaults.dialogue.minimumQuotedLength,
);

// NOTE: 하한이 목표의 절반이면 그 사이 분량이 그대로 채택돼 원고가 목표에 상시 미달한다. 재시도가
// 실제로 걸리도록 목표에 가깝게 잡고, 재시도로도 못 채우면 헤더 경고로 남긴다.
//
// NOTE: 살붙임은 문맥에 맞춰 조사나 군더더기를 정리한다. 완전 일치로 보면 그런 재작성이 전부
// 누락으로 잡히고, 재시도할 때마다 표현이 또 달라져 수렴하지도 않는다. 실측상 재작성은 87%,
// 앞부분만 남기고 잘린 대사는 42%, 다른 대사로 대체된 경우는 18%라 그 사이에서 끊는다.
export const DIALOGUE_PRESERVED_RATIO = pipelineDefaults.dialogue.preservedRatio;

// NOTE: 살붙임은 긴 한 턴을 두세 문장으로 쪼개 호흡을 만든다. 조각 하나씩 원문과 비교하면 각각이
// 임계값에 못 미쳐 사라진 것으로 잡히므로, 이어진 조각을 합친 것과도 비교한다.
function isDialoguePreserved(
  line: string,
  candidates: readonly string[],
  preservedRatio: number,
  splitLimit: number,
): boolean {
  for (let start = 0; start < candidates.length; start += 1) {
    let joined = '';

    for (let width = 0; width < splitLimit && start + width < candidates.length; width += 1) {
      joined = width === 0 ? (candidates[start] as string) : `${joined} ${candidates[start + width]}`;

      if (similarityRatio(line, joined) >= preservedRatio) {
        return true;
      }
    }
  }

  return false;
}

// 두 문자열이 공유하는 부분의 비율. difflib의 SequenceMatcher.ratio와 같은 정의다.
function similarityRatio(left: string, right: string): number {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 1 : 0;
  }

  return (2 * matchedLength(left, right)) / (left.length + right.length);
}

function matchedLength(left: string, right: string): number {
  const previous = new Array<number>(right.length + 1).fill(0);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] =
        left[i - 1] === right[j - 1]
          ? (previous[j - 1] as number) + 1
          : Math.max(previous[j] as number, current[j - 1] as number);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] as number;
}

// NOTE: 뼈대가 정답지라서 위반을 AI 없이 결정론적으로 가려낼 수 있다. 살붙임은 문장만 두껍게 하는
// 작업이므로, 뼈대에 없던 인물이나 사라진 대사는 그 자체로 규칙 위반이다.
// NOTE: 살붙임이 직전 구간을 다시 써 내면 원고 후반이 전반의 복사본이 된다. 구간마다 따로
// 검사하면 각 구간은 멀쩡해 보이므로 여기서 겹침을 직접 본다. 길이만으로는 판별할 수 없다 —
// 길게 쓴 구간과 앞 구간을 삼킨 구간의 글자 수가 같을 수 있다.
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

  const previous = withoutWhitespace(previousSection);
  const written = withoutWhitespace(expanded);
  let repeated = 0;

  for (let start = 0; start + window <= previous.length; start += window) {
    if (written.includes(previous.slice(start, start + window))) {
      repeated += window;
    }
  }

  return repeated;
}

// NOTE: 뼈대가 같은 대사 묶음을 두 번 적으면 그 두 자리가 각각 다른 문장으로 살이 붙어, 원고
// 후반이 전반을 되풀이한다. 살붙임 결과만 비교하면 주변 서술이 달라 눈치챌 수 없다 — 뼈대에서
// 잡아야 한다. 인물이 한 마디를 되뇌는 것과 구분하려고 "연속된 여러 대사가 순서까지 같게"
// 다시 나오는 경우만 센다.
function dialogueLinesOf(text: string, tuning: ResolvedSceneGenerationTuning): string[] {
  return [...text.matchAll(quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength))]
    .map((match) => (match[1] ?? '').replace(/\s/g, ''))
    .filter((line) => line.length >= tuning.dialogueMinimumLineLength);
}

// 살붙임은 구간마다 문장을 새로 쓰므로 두 구간이 같은 사건을 다뤄도 서술이 겹치지 않는다.
// 같은 것은 뼈대에서 온 대사뿐이라, 겹침은 대사로 재야 보인다.
export function findRepeatedDialogueRunBetween(
  first: string,
  second: string,
  tuning?: SceneGenerationTuning,
): number {
  const resolved = resolveSceneGenerationTuning(tuning);
  const left = dialogueLinesOf(first, resolved);
  const right = dialogueLinesOf(second, resolved);
  let longest = 0;

  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      let run = 0;

      while (i + run < left.length && j + run < right.length && left[i + run] === right[j + run]) {
        run += 1;
      }

      longest = Math.max(longest, run);
    }
  }

  return longest;
}

export function findRepeatedDialogueRun(text: string, tuning?: SceneGenerationTuning): number {
  const lines = dialogueLinesOf(text, resolveSceneGenerationTuning(tuning));
  let longest = 0;

  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 1; second < lines.length; second += 1) {
      let run = 0;

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

// NOTE: 뼈대는 일부러 얇게 쓰는 단계라 살붙임(0.85)만큼 죄지 않는다. 실측에서 뼈대가 목표의 1/3만
// 나오면 살붙임이 9배 확장을 떠안아 분량이 목표 절반에도 못 미쳤다. 절반 아래면 한 번 더 부른다.
export function validateSceneSkeleton(
  skeleton: string,
  targetLength?: number,
  tuning?: SceneGenerationTuning,
): SectionViolation[] {
  const resolved = resolveSceneGenerationTuning(tuning);
  const violations: SectionViolation[] = [];
  const run = findRepeatedDialogueRun(skeleton, tuning);

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
      detail: `뼈대가 목표 ${targetLength.toLocaleString()}자의 절반에도 못 미칩니다 (${skeleton.length.toLocaleString()}자). 묘사를 더하지 말고 사건을 단계로 쪼개고 주고받는 말을 여러 턴으로 늘리세요`,
    });
  }

  return violations;
}

export function validateExpandedSection(input: {
  readonly skeleton: string;
  readonly section: string;
  readonly expanded: string;
  readonly characters: readonly CharacterCard[];
  readonly targetLength: number;
  readonly previousSection?: string;
  // 모델 문체에 따라 같은 대사를 옮겨 적는 방식이 달라 임계가 고정이면 오탐이 난다.
  // NOTE: 아래 두 필드는 tuning 이 생기기 전의 이름이다. 둘 다 주면 개별 필드가 이긴다.
  readonly dialoguePreservedRatio?: number;
  readonly paddingParagraphRatio?: number;
  readonly tuning?: SceneGenerationTuning;
}): SectionViolation[] {
  const resolved = resolveSceneGenerationTuning(input.tuning);
  const preservedRatio = input.dialoguePreservedRatio ?? resolved.dialoguePreservedRatio;
  const paddingRatio = input.paddingParagraphRatio ?? resolved.paddingParagraphRatio;
  const violations: SectionViolation[] = [];

  // 출연진은 씬 전체가 정한다. 구간만 보면 대명사로 가리킨 인물을 살붙임이 이름으로 부를 때마다 오탐이 난다.
  const inSkeleton = detectCanonicalCast(input.skeleton, input.characters);
  const added = [...detectCanonicalCast(input.expanded, input.characters)].filter(
    (name) => !inSkeleton.has(name),
  );

  if (added.length > 0) {
    violations.push({
      kind: 'cast',
      detail: `뼈대에 없는 인물이 등장합니다 (${added.join(', ')})`,
    });
  }

  const foreign = findForeignScriptSpans(input.expanded);
  if (foreign.length > 0) {
    violations.push({
      kind: 'foreign-script',
      detail: `외국 문자가 섞였습니다 (${foreign.map((span) => `"${span.text}"`).join(', ')})`,
    });
  }

  const quoted = quotedDialoguePatternFor(resolved.dialogueMinimumQuotedLength);
  const expandedLines = [...input.expanded.matchAll(quoted)].map((match) =>
    (match[1] ?? '').trim(),
  );
  const lost = [...input.section.matchAll(quoted)]
    .map((match) => (match[1] ?? '').trim())
    .filter(
      (line) =>
        line.length >= resolved.dialogueMinimumLineLength &&
        !isDialoguePreserved(line, expandedLines, preservedRatio, resolved.dialogueSplitLimit),
    );

  if (lost.length > 0) {
    violations.push({
      kind: 'lost-dialogue',
      detail: `뼈대의 대사가 사라졌습니다 ("${lost[0] as string}"${lost.length > 1 ? ` 외 ${lost.length - 1}건` : ''})`,
    });
  }

  if (input.expanded.length < input.targetLength * resolved.sectionMinimumLengthRatio) {
    violations.push({
      kind: 'too-short',
      detail: `목표 ${input.targetLength.toLocaleString()}자에 크게 못 미칩니다 (${input.expanded.length.toLocaleString()}자). 사건 사이의 감각·행동·내면을 더 쓰되 이미 쓴 문장을 되풀이하지는 마세요`,
    });
  }

  const repeated = repeatedFromPrevious(
    input.previousSection,
    input.expanded,
    resolved.sectionRepeatedRunWindow,
  );
  if (repeated >= resolved.sectionRepeatedRunLimit) {
    violations.push({
      kind: 'repeats-previous',
      detail: `직전 구간을 약 ${repeated.toLocaleString()}자 다시 썼습니다. 이번 구간의 사건만 쓰세요`,
    });
  }

  // 문장을 새로 쓰면 축자 비교를 빠져나간다. 같은 사건을 다시 다뤘는지는 대사로만 드러난다.
  const repeatedDialogue =
    input.previousSection === undefined
      ? 0
      : findRepeatedDialogueRunBetween(input.previousSection, input.expanded, input.tuning);

  if (repeatedDialogue >= resolved.dialogueRepeatedRunLimit) {
    violations.push({
      kind: 'repeats-previous',
      detail: `직전 구간의 대사 ${repeatedDialogue}개를 순서까지 같게 다시 썼습니다. 이번 구간의 사건만 쓰세요`,
    });
  }

  const padding = findPaddingRepetition(
    input.section,
    input.expanded,
    input.previousSection,
    paddingRatio,
    resolved,
  );
  if (padding !== undefined) {
    violations.push({ kind: 'repetition', detail: padding });
  }

  return violations;
}

// NOTE: 새 사건을 못 만들게 한 채 분량을 요구하면, 모델이 분량을 채우는 유일한 수단은 되풀이다.
// 실측에서 앞 구간이 쪼개 쓴 대사 턴을 다음 구간이 통째로 다시 쓰고, 마무리 동작을 두 번 넣었다.
// 되풀이는 위 검사들이 보는 "구간 전체를 다시 씀"보다 작은 단위라 따로 잡는다. 대사는 정확히,
// 지문은 문단 유사도로 본다.
export const PADDING_PARAGRAPH_RATIO = pipelineDefaults.padding.paragraphRatio;

function findPaddingRepetition(
  section: string,
  expanded: string,
  previousSection: string | undefined,
  paddingRatio: number,
  tuning: ResolvedSceneGenerationTuning,
): string | undefined {
  const repeatedLine = findRepeatedDialogueLine(section, expanded, previousSection, tuning);
  if (repeatedLine !== undefined) {
    return `같은 대사를 두 번 썼습니다 ("${repeatedLine}"). 분량이 모자라도 이미 쓴 대사를 되풀이하지 마세요`;
  }

  const repeatedParagraph = findNearDuplicateParagraph(
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
  const counts = new Map<string, number>();

  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  return counts;
}

// 뼈대 조각에 한 번 있는 대사가 두 번 나오거나, 직전 구간에서 이미 쓴 대사가 이 조각에 없는데
// 다시 나오면 되풀이다. 조각 자체가 같은 말을 두 번 시키는 경우(되뇌기)는 그대로 둔다.
function findRepeatedDialogueLine(
  section: string,
  expanded: string,
  previousSection: string | undefined,
  tuning: ResolvedSceneGenerationTuning,
): string | undefined {
  const allowed = countOccurrences(dialogueLinesOf(section, tuning));
  const written = dialogueLinesOf(expanded, tuning);
  const writtenCounts = countOccurrences(written);
  const previous = new Set(
    previousSection === undefined ? [] : dialogueLinesOf(previousSection, tuning),
  );

  for (const line of written) {
    const count = writtenCounts.get(line) ?? 0;
    const permitted = allowed.get(line) ?? 0;

    if (count > Math.max(1, permitted) || (permitted === 0 && previous.has(line))) {
      return line;
    }
  }

  return undefined;
}

function narrationParagraphsOf(text: string, tuning: ResolvedSceneGenerationTuning): string[] {
  const quoted = quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength);

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
  const paragraphs = narrationParagraphsOf(expanded, tuning);
  const earlier =
    previousSection === undefined ? [] : narrationParagraphsOf(previousSection, tuning);

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index] as string;
    const candidates = [...earlier, ...paragraphs.slice(0, index)];

    if (candidates.some((other) => similarityRatio(paragraph, other) >= paddingRatio)) {
      return paragraph;
    }
  }

  return undefined;
}

function countDialogueTurns(text: string, tuning: ResolvedSceneGenerationTuning): number {
  return [...text.matchAll(quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength))].length;
}

// NOTE: 다듬기는 대사 문장을 바꾸는 작업이라 대사 보존은 검사할 수 없다. 대신 턴 수를 센다. 개수와
// 순서를 뼈대 그대로 두는 것이 이 단계의 규칙이므로 양쪽 모두 위반이다. 늘어난 턴은 새 정보를 담을
// 수 없어 앞 대사를 되풀이하는 빈 되묻기가 되고, 줄어든 턴은 대사가 조용히 사라진 것이다.
export function validatePolishedSkeleton(input: {
  readonly skeleton: string;
  readonly polished: string;
  readonly characters: readonly CharacterCard[];
  readonly lengthLimit: number;
  readonly tuning?: SceneGenerationTuning;
}): SectionViolation[] {
  const resolved = resolveSceneGenerationTuning(input.tuning);
  const violations: SectionViolation[] = [];

  const before = detectCanonicalCast(input.skeleton, input.characters);
  const added = [...detectCanonicalCast(input.polished, input.characters)].filter(
    (name) => !before.has(name),
  );

  if (added.length > 0) {
    violations.push({ kind: 'cast', detail: `뼈대에 없는 인물이 등장합니다 (${added.join(', ')})` });
  }

  const foreign = findForeignScriptSpans(input.polished);
  if (foreign.length > 0) {
    violations.push({
      kind: 'foreign-script',
      detail: `외국 문자가 섞였습니다 (${foreign.map((span) => `"${span.text}"`).join(', ')})`,
    });
  }

  const turnDelta =
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

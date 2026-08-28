import { characterMatchTokens, detectCharactersInText } from '@storyboard/story-format';
import type { CharacterCard } from '@storyboard/story-format';
import { findForeignScriptSpans } from '@storyboard/story-format';

// 한 번의 살붙임 호출이 낼 수 있는 최대 분량. 출력 한도에 걸려 뒷부분이 잘리는 것을 막는다.
export const SECTION_OUTPUT_LIMIT = 7000;

// NOTE: 뼈대를 문단 경계에서 끊어 구간으로 나눈다. 구간 수는 목표 분량이 상한을 넘지 않는 최소값이라,
// 짧은 씬은 사실상 단일 패스로 돌고 긴 씬만 쪼개진다.
export function planSectionCount(targetLength: number, outputLimit = SECTION_OUTPUT_LIMIT): number {
  if (targetLength <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(targetLength / outputLimit));
}

export function splitSkeletonIntoSections(skeleton: string, sectionCount: number): string[] {
  const trimmed = skeleton.trim();

  if (sectionCount <= 1) {
    return [trimmed];
  }

  const paragraphs = trimmed
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length <= 1) {
    return [trimmed];
  }

  // 문단을 순서대로 담되, 남은 문단이 남은 구간 수와 같아지면 곧바로 닫아 빈 구간이 생기지 않게 한다.
  const budget = trimmed.length / sectionCount;
  const sections: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  paragraphs.forEach((paragraph, index) => {
    current.push(paragraph);
    currentLength += paragraph.length;

    const remainingParagraphs = paragraphs.length - index - 1;
    const remainingSections = sectionCount - sections.length - 1;
    const filled = currentLength >= budget && remainingSections > 0;
    const mustClose = remainingParagraphs > 0 && remainingParagraphs === remainingSections;

    if (filled || mustClose) {
      sections.push(current.join('\n\n'));
      current = [];
      currentLength = 0;
    }
  });

  if (current.length > 0) {
    sections.push(current.join('\n\n'));
  }

  return sections;
}

export interface SectionViolation {
  readonly kind: 'cast' | 'foreign-script' | 'lost-dialogue' | 'too-short';
  readonly detail: string;
}

const quotedDialoguePattern = /[“"]([^”"\n]{4,})[”"]/g;
const minimumLengthRatio = 0.5;

// NOTE: 뼈대가 정답지라서 위반을 AI 없이 결정론적으로 가려낼 수 있다. 살붙임은 문장만 두껍게 하는
// 작업이므로, 뼈대에 없던 인물이나 사라진 대사는 그 자체로 규칙 위반이다.
export function validateExpandedSection(input: {
  readonly section: string;
  readonly expanded: string;
  readonly characters: readonly CharacterCard[];
  readonly targetLength: number;
}): SectionViolation[] {
  const violations: SectionViolation[] = [];

  const tokens = input.characters.flatMap((card) => characterMatchTokens(card));
  const inSkeleton = new Set(detectCharactersInText(input.section, tokens));
  const added = [...new Set(detectCharactersInText(input.expanded, tokens))].filter(
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

  const lost = [...input.section.matchAll(quotedDialoguePattern)]
    .map((match) => (match[1] ?? '').trim())
    .filter((line) => line.length >= 6 && !input.expanded.includes(line));

  if (lost.length > 0) {
    violations.push({
      kind: 'lost-dialogue',
      detail: `뼈대의 대사가 사라졌습니다 ("${lost[0] as string}"${lost.length > 1 ? ` 외 ${lost.length - 1}건` : ''})`,
    });
  }

  if (input.expanded.length < input.targetLength * minimumLengthRatio) {
    violations.push({
      kind: 'too-short',
      detail: `목표 ${input.targetLength.toLocaleString()}자의 절반에 못 미칩니다 (${input.expanded.length.toLocaleString()}자)`,
    });
  }

  return violations;
}

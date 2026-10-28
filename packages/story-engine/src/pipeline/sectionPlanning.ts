import { integerSettingDefault } from '@storyboard/story-model';

export const SECTION_OUTPUT_LIMIT: number = integerSettingDefault('generation.section.outputLimit');

export function planSectionCount(targetLength: number, outputLimit = SECTION_OUTPUT_LIMIT): number {
  if (targetLength <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(targetLength / outputLimit));
}

export const SCENE_BREAK_LINE: string = '---';

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

function lengthAtNextSceneBreak(
  units: readonly SkeletonUnit[],
  fromIndex: number,
  currentLength: number,
): number | undefined {
  let length: number = currentLength;

  for (const unit of units.slice(fromIndex + 1)) {
    if (unit.endsScene) {
      return length + unit.text.length;
    }
    length += unit.text.length;
  }

  return undefined;
}

export function splitSkeletonIntoSections(skeleton: string, sectionCount: number): string[] {
  const trimmed: string = skeleton.trim();

  if (sectionCount <= 1) {
    return [trimmed];
  }

  const units: SkeletonUnit[] = splitIntoUnits(trimmed);
  const splittable: SkeletonUnit[] = units.filter((unit) => !unit.endsScene);

  if (splittable.length <= 1) {
    return [trimmed];
  }

  const sections: string[] = [];
  let remainingLength: number = units.reduce((sum, unit) => sum + unit.text.length, 0);
  let current: string[] = [];
  let currentLength: number = 0;
  let closedSections: number = 0;

  units.forEach((unit, index) => {
    current.push(unit.text);
    currentLength += unit.text.length;

    const remainingUnits: number = units.slice(index + 1).filter((rest) => !rest.endsScene).length;
    const remainingSections: number = sectionCount - closedSections - 1;
    if (remainingSections <= 0 || remainingUnits === 0) {
      return;
    }

    const budget: number = remainingLength / (sectionCount - closedSections);
    const nextBreakLength: number | undefined = lengthAtNextSceneBreak(units, index, currentLength);
    const atSceneBreak: boolean =
      unit.endsScene &&
      currentLength >= budget / 2 &&
      (nextBreakLength === undefined ||
        Math.abs(currentLength - budget) <= Math.abs(nextBreakLength - budget));
    const nextUnit: SkeletonUnit | undefined = units[index + 1];
    const startsWithDialogue = (text: string): boolean => /^[“"]/.test(text);
    const continuesExchange: boolean =
      startsWithDialogue(unit.text) ||
      (nextUnit !== undefined && !nextUnit.endsScene && startsWithDialogue(nextUnit.text));
    const filled: boolean =
      currentLength >= budget && (!continuesExchange || currentLength >= budget * 1.5);
    const mustClose: boolean = remainingUnits === remainingSections;

    if (atSceneBreak || filled || mustClose) {
      sections.push(current.join('\n\n'));
      remainingLength -= currentLength;
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

export function planSectionTargetLengths(
  sections: readonly string[],
  totalTarget: number,
  outputLimit = SECTION_OUTPUT_LIMIT,
): number[] {
  const weights: number[] = sections.map((section) => section.replace(/\s/g, '').length);
  const totalWeight: number = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight === 0) {
    return sections.map(() => Math.max(1, Math.round(totalTarget / sections.length)));
  }

  let targets: number[] = weights.map((weight) =>
    Math.min(outputLimit, Math.max(1, Math.round((totalTarget * weight) / totalWeight))),
  );

  for (let round: number = 0; round < sections.length; round += 1) {
    const shortfall: number = totalTarget - targets.reduce((sum, target) => sum + target, 0);
    const openWeights: number[] = weights.map((weight, index) =>
      (targets[index] as number) < outputLimit ? weight : 0,
    );
    const openWeight: number = openWeights.reduce((sum, weight) => sum + weight, 0);

    if (shortfall <= 0 || openWeight === 0) {
      break;
    }

    targets = targets.map((target, index) =>
      Math.min(
        outputLimit,
        target + Math.round((shortfall * (openWeights[index] as number)) / openWeight),
      ),
    );
  }

  return targets;
}

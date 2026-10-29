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

function startsWithDialogue(text: string): boolean {
  return /^[“"]/.test(text);
}

class SkeletonSectionBuilder {
  private readonly sections: string[] = [];
  private remainingLength: number;
  private current: string[] = [];
  private currentLength: number = 0;
  private closedSections: number = 0;

  public constructor(
    private readonly units: readonly SkeletonUnit[],
    private readonly sectionCount: number,
  ) {
    this.remainingLength = units.reduce((sum, unit) => sum + unit.text.length, 0);
  }

  public addUnit(unit: SkeletonUnit, index: number): void {
    this.current.push(unit.text);
    this.currentLength += unit.text.length;

    if (this.shouldCloseAfter(unit, index)) {
      this.closeSection();
    }
  }

  public toSections(): string[] {
    if (this.current.length > 0) {
      this.sections.push(this.current.join('\n\n'));
    }

    return this.sections;
  }

  private shouldCloseAfter(unit: SkeletonUnit, index: number): boolean {
    const remainingUnits: number = this.units
      .slice(index + 1)
      .filter((rest) => !rest.endsScene).length;
    const remainingSections: number = this.sectionCount - this.closedSections - 1;
    if (remainingSections <= 0 || remainingUnits === 0) {
      return false;
    }

    const budget: number = this.remainingLength / (this.sectionCount - this.closedSections);
    const atSceneBreak: boolean = this.isBalancedSceneBreak(unit, index, budget);
    const filled: boolean = this.isFilled(unit, index, budget);
    const mustClose: boolean = remainingUnits === remainingSections;

    return atSceneBreak || filled || mustClose;
  }

  private isBalancedSceneBreak(unit: SkeletonUnit, index: number, budget: number): boolean {
    const nextBreakLength: number | undefined = lengthAtNextSceneBreak(
      this.units,
      index,
      this.currentLength,
    );

    return (
      unit.endsScene &&
      this.currentLength >= budget / 2 &&
      (nextBreakLength === undefined ||
        Math.abs(this.currentLength - budget) <= Math.abs(nextBreakLength - budget))
    );
  }

  private isFilled(unit: SkeletonUnit, index: number, budget: number): boolean {
    const nextUnit: SkeletonUnit | undefined = this.units[index + 1];
    const continuesExchange: boolean =
      startsWithDialogue(unit.text) ||
      (nextUnit !== undefined && !nextUnit.endsScene && startsWithDialogue(nextUnit.text));

    return (
      this.currentLength >= budget && (!continuesExchange || this.currentLength >= budget * 1.5)
    );
  }

  private closeSection(): void {
    this.sections.push(this.current.join('\n\n'));
    this.remainingLength -= this.currentLength;
    this.current = [];
    this.currentLength = 0;
    this.closedSections += 1;
  }
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

  const builder: SkeletonSectionBuilder = new SkeletonSectionBuilder(units, sectionCount);
  units.forEach((unit, index) => builder.addUnit(unit, index));

  return builder.toSections();
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

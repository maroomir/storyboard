import { castNameOf, type SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { weighViolations } from '#engine/pipeline/scene/skeletonChecks';
import { countSceneBreakLines, restoreSceneBreaks } from '#engine/pipeline/sceneBreakPlan';
import { sectionPlaces, sectionSceneCoordinates } from '#engine/pipeline/sceneCoordinates';
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { ResolvedSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import {
  planSectionCount,
  planSectionTargetLengths,
  SECTION_OUTPUT_LIMIT,
  splitSkeletonIntoSections,
} from '#engine/pipeline/sectionPlanning';
import {
  countRecapPhrases,
  describeThinExpansionSpots,
  findCatchphraseOveruse,
  findRunAheadDialogue,
  findThinExpansionSpots,
  trimRunAheadDialogue,
  validateExpandedSection,
  type SectionViolation,
} from '#engine/pipeline/sectionValidation';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import { scopeBackgroundFacts } from '#engine/pipeline/sectionBackgroundFacts';
import type { GenerateTextOptions } from '@storyboard/story-ai';
import {
  formatBackgroundFactConflict,
  type Background,
  type SceneBeat,
  type StyleDirective,
} from '@storyboard/story-model';

export interface CheckedSectionText {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
}

export function backgroundFactLines(background: Background): string[] {
  const header: string = [background.time, background.weather]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join(', ');

  return [
    ...(header.length > 0 ? [header] : []),
    ...(background.description ?? []),
    ...(background.senses ?? []),
  ].filter((line) => line.trim().length > 0);
}

export function restoreSectionBreaks(
  section: string,
  outcome: { readonly text: string; readonly violations: readonly SectionViolation[] },
): CheckedSectionText {
  if (!outcome.violations.some((violation) => violation.kind === 'scene-breaks')) {
    return outcome;
  }

  const restored: string | undefined = restoreSceneBreaks(section, outcome.text);
  if (restored === undefined || countSceneBreakLines(restored) !== countSceneBreakLines(section)) {
    return outcome;
  }

  return {
    text: restored,
    violations: [
      ...outcome.violations.filter((violation) => violation.kind !== 'scene-breaks'),
      {
        kind: 'scene-breaks',
        detail: `살붙임이 바꾼 장면 전환(---)을 뼈대 조각의 자리에 맞춰 되살렸습니다`,
      },
    ],
  };
}

export function sectionTargetLengths(
  styleDirective: StyleDirective | undefined,
  sections: readonly string[],
  outputLimit: number,
): number[] {
  const target: number = styleDirective?.targetWordCount ?? outputLimit * sections.length;
  return planSectionTargetLengths(sections, target, outputLimit);
}

export function trimRunAhead(
  skeleton: string,
  section: string,
  outcome: { readonly text: string; readonly violations: readonly SectionViolation[] },
  tuning: ResolvedSceneGenerationTuning,
): CheckedSectionText {
  if (!outcome.violations.some((violation) => violation.kind === 'runs-ahead')) {
    return outcome;
  }

  const lines: string[] = findRunAheadDialogue(skeleton, section, outcome.text, tuning);
  const trimmed: string = trimRunAheadDialogue(outcome.text, lines);
  if (trimmed === outcome.text) {
    return outcome;
  }

  return {
    text: trimmed,
    violations: [
      ...outcome.violations.filter((violation) => violation.kind !== 'runs-ahead'),
      {
        kind: 'runs-ahead',
        detail: `다음 구간의 대사를 앞당겨 쓴 끝부분 ${(outcome.text.length - trimmed.length).toLocaleString()}자를 잘라 냈습니다`,
      },
    ],
  };
}

interface SectionExpansionRequest {
  readonly section: string;
  readonly previousSection: string | undefined;
  readonly targetLength: number;
  readonly backgroundFacts: readonly string[];
  readonly sceneCoordinates: readonly string[];
  readonly sectionPlaces: readonly string[];
}

interface SectionExpansionPlan {
  readonly sections: string[];
  readonly targetLengths: number[];
  readonly coordinatesBySection: string[][];
  readonly placesBySection: string[][];
  readonly scenePlaces: string[];
  readonly backgroundFacts: string[];
}

interface SectionRetryHint {
  readonly retryReasons: string[];
  readonly isUnderLengthRetry: boolean;
}

interface RejectedSectionAttempt {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
  readonly weight: number;
  readonly isUnderLength: boolean;
  readonly thinSpots: string | undefined;
}

interface RankedSectionText extends CheckedSectionText {
  readonly weight: number;
  readonly distance: number;
}

class SectionExpansionAttempts {
  private reasons: string[] = [];
  private isUnderLengthRetry: boolean = false;
  private best: RankedSectionText;

  public constructor(
    section: string,
    private readonly targetLength: number,
  ) {
    this.best = {
      text: section,
      violations: [],
      weight: Number.POSITIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY,
    };
  }

  public describeRetry(): SectionRetryHint {
    return { retryReasons: this.reasons, isUnderLengthRetry: this.isUnderLengthRetry };
  }

  public recordRejected(attempt: RejectedSectionAttempt): void {
    const { weight } = attempt;
    const distance: number = Math.abs(attempt.text.length - this.targetLength);
    if (
      weight < this.best.weight ||
      (weight === this.best.weight && distance < this.best.distance)
    ) {
      this.best = { text: attempt.text, violations: attempt.violations, weight, distance };
    }

    this.isUnderLengthRetry = attempt.isUnderLength;
    this.reasons = [
      ...attempt.violations.map((violation) => violation.detail),
      ...(attempt.thinSpots === undefined ? [] : [attempt.thinSpots]),
    ];
  }

  public toBestOutcome(): CheckedSectionText {
    return { text: this.best.text, violations: this.best.violations };
  }
}

export class ExpandSectionStage implements ISceneStage {
  public readonly id: SceneStageId = 'expandSection';

  public async run(run: SceneGenerationRun): Promise<void> {
    const plan: SectionExpansionPlan = this.planSectionExpansion(run);
    const expandedSections: string[] = [];

    for (let index: number = 0; index < plan.sections.length; index += 1) {
      run.onProgress?.('expandSection', index + 1, plan.sections.length);

      const repaired: CheckedSectionText = await this.expandAndRepairSection(
        run,
        plan,
        index,
        expandedSections.at(-1),
      );
      expandedSections.push(repaired.text);
      this.addSectionWarnings(run, index, repaired);
      assertNotCancelled(run.shouldCancel);
    }

    run.draftBody = expandedSections.join('\n\n');
    run.warnings.push(
      ...findCatchphraseOveruse({
        text: run.draftBody,
        characters: run.context.characters,
        beatCount: run.context.scene.card?.beats?.length ?? 0,
        tuning: run.tuning,
      }),
    );
  }

  private planSectionExpansion(run: SceneGenerationRun): SectionExpansionPlan {
    const outputLimit: number = run.input.sectionOutputLimit ?? SECTION_OUTPUT_LIMIT;
    const sections: string[] = splitSkeletonIntoSections(
      run.polishedText,
      planSectionCount(run.styleDirective?.targetWordCount ?? 0, outputLimit),
    );
    const targetLengths: number[] = sectionTargetLengths(run.styleDirective, sections, outputLimit);
    const beats: SceneBeat[] = run.context.scene.card?.beats ?? [];
    const coordinatesBySection: string[][] = sectionSceneCoordinates(
      run.sceneCoordinates,
      sections,
      beats,
      castNameOf(run.context),
    );
    const placesBySection: string[][] = sectionPlaces(run.sceneCoordinates, sections, beats);
    const scenePlaces: string[] = beats.flatMap((beat) =>
      typeof beat === 'string' || beat.place === undefined ? [] : [beat.place],
    );
    const backgroundFacts: string[] = backgroundFactLines(run.background);

    return {
      sections,
      targetLengths,
      coordinatesBySection,
      placesBySection,
      scenePlaces,
      backgroundFacts,
    };
  }

  private async expandAndRepairSection(
    run: SceneGenerationRun,
    plan: SectionExpansionPlan,
    index: number,
    previousSection: string | undefined,
  ): Promise<CheckedSectionText> {
    const section: string = plan.sections[index] as string;
    const outcome: CheckedSectionText = await this.expandSectionWithRetries(
      run,
      this.buildSectionRequest(plan, index, previousSection),
      withAttribution(
        {
          ...buildGenerateOptions(run.providers, 'sceneSectionExpansion'),
          styleDirective: run.styleDirective,
        },
        { primary: run.sceneRef },
      ),
    );

    return restoreSectionBreaks(
      section,
      trimRunAhead(run.polishedText, section, outcome, run.tuning),
    );
  }

  private buildSectionRequest(
    plan: SectionExpansionPlan,
    index: number,
    previousSection: string | undefined,
  ): SectionExpansionRequest {
    return {
      section: plan.sections[index] as string,
      previousSection,
      targetLength: plan.targetLengths[index] as number,
      backgroundFacts: scopeBackgroundFacts(
        plan.backgroundFacts,
        plan.placesBySection[index] ?? [],
        plan.scenePlaces,
      ),
      sceneCoordinates: plan.coordinatesBySection[index] ?? [],
      sectionPlaces: plan.placesBySection[index] ?? [],
    };
  }

  private addSectionWarnings(
    run: SceneGenerationRun,
    index: number,
    repaired: CheckedSectionText,
  ): void {
    run.warnings.push(
      ...repaired.violations.map((violation) => `${index + 1}구간: ${violation.detail}`),
    );
    const recaps: number = countRecapPhrases(repaired.text);
    if (recaps > run.tuning.sectionRecapPhraseLimit) {
      run.warnings.push(
        `${index + 1}구간: 앞 장면을 «아까 …»로 되짚는 표현이 ${recaps}회입니다 (허용 ${run.tuning.sectionRecapPhraseLimit}회). 새 반응·논평·대사로 채우는 쪽이 낫습니다`,
      );
    }
  }

  private async expandSectionWithRetries(
    run: SceneGenerationRun,
    request: SectionExpansionRequest,
    options: GenerateTextOptions,
  ): Promise<CheckedSectionText> {
    const attempts: SectionExpansionAttempts = new SectionExpansionAttempts(
      request.section,
      request.targetLength,
    );

    for (let attempt: number = 0; attempt <= run.tuning.sectionRetryLimit; attempt += 1) {
      const expanded: string = await this.requestSectionExpansion(
        run,
        request,
        options,
        attempts.describeRetry(),
      );
      const violations: SectionViolation[] = this.validateSection(run, request, expanded);

      if (violations.length === 0) {
        return { text: expanded, violations: [] };
      }

      const isUnderLength: boolean = violations.some((violation) => violation.kind === 'too-short');
      attempts.recordRejected({
        text: expanded,
        violations,
        weight: weighViolations(violations, run.tuning.violationWeights),
        isUnderLength,
        thinSpots: isUnderLength ? this.describeThinSpots(run, request, expanded) : undefined,
      });
    }

    return attempts.toBestOutcome();
  }

  private async requestSectionExpansion(
    run: SceneGenerationRun,
    request: SectionExpansionRequest,
    options: GenerateTextOptions,
    retry: SectionRetryHint,
  ): Promise<string> {
    return run.aiService.expandSceneSection(
      {
        skeleton: run.polishedText,
        section: request.section,
        previousSection: request.previousSection,
        targetLength: request.targetLength,
        backgroundFacts: request.backgroundFacts,
        backgroundConflicts: run.backgroundFactConflicts.map(formatBackgroundFactConflict),
        sceneCoordinates: request.sceneCoordinates,
        retryReasons: retry.retryReasons,
        isUnderLengthRetry: retry.isUnderLengthRetry,
      },
      options,
    );
  }

  private validateSection(
    run: SceneGenerationRun,
    request: SectionExpansionRequest,
    expanded: string,
  ): SectionViolation[] {
    return validateExpandedSection({
      skeleton: run.polishedText,
      section: request.section,
      expanded,
      characters: run.context.characters,
      targetLength: request.targetLength,
      ...(request.previousSection === undefined
        ? {}
        : { previousSection: request.previousSection }),
      sectionPlaces: request.sectionPlaces,
      backgroundFacts: request.backgroundFacts,
      tuning: run.tuning,
    });
  }

  private describeThinSpots(
    run: SceneGenerationRun,
    request: SectionExpansionRequest,
    expanded: string,
  ): string | undefined {
    return describeThinExpansionSpots(
      findThinExpansionSpots(request.section, expanded, run.tuning.dialogueMinimumQuotedLength),
    );
  }
}

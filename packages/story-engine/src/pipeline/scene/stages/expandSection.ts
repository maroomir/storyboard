import { castNameOf, type SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { weighViolations } from '#engine/pipeline/scene/skeletonDrafting';
import { countSceneBreakLines, restoreSceneBreaks } from '#engine/pipeline/sceneBreakPlan';
import { sectionPlaces, sectionSceneCoordinates } from '#engine/pipeline/sceneCoordinates';
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { ResolvedSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import {
  countRecapPhrases,
  describeThinExpansionSpots,
  findCatchphraseOveruse,
  findRunAheadDialogue,
  findThinExpansionSpots,
  planSectionCount,
  planSectionTargetLengths,
  SECTION_OUTPUT_LIMIT,
  splitSkeletonIntoSections,
  trimRunAheadDialogue,
  validateExpandedSection,
  type SectionViolation,
} from '#engine/pipeline/sceneSectionPlan';
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

export class ExpandSectionStage implements ISceneStage {
  public readonly id: SceneStageId = 'expandSection';

  public async run(run: SceneGenerationRun): Promise<void> {
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
    const expandedSections: string[] = [];

    for (let index: number = 0; index < sections.length; index += 1) {
      run.onProgress?.('expandSection', index + 1, sections.length);

      const outcome: CheckedSectionText = await this.expandSectionWithRetries(
        run,
        {
          section: sections[index] as string,
          previousSection: expandedSections.at(-1),
          targetLength: targetLengths[index] as number,
          backgroundFacts: scopeBackgroundFacts(
            backgroundFacts,
            placesBySection[index] ?? [],
            scenePlaces,
          ),
          sceneCoordinates: coordinatesBySection[index] ?? [],
          sectionPlaces: placesBySection[index] ?? [],
        },
        withAttribution(
          {
            ...buildGenerateOptions(run.providers, 'sceneSectionExpansion'),
            styleDirective: run.styleDirective,
          },
          { primary: run.sceneRef },
        ),
      );

      const repaired: CheckedSectionText = restoreSectionBreaks(
        sections[index] as string,
        trimRunAhead(run.polishedText, sections[index] as string, outcome, run.tuning),
      );
      expandedSections.push(repaired.text);
      run.warnings.push(
        ...repaired.violations.map((violation) => `${index + 1}구간: ${violation.detail}`),
      );
      const recaps: number = countRecapPhrases(repaired.text);
      if (recaps > run.tuning.sectionRecapPhraseLimit) {
        run.warnings.push(
          `${index + 1}구간: 앞 장면을 «아까 …»로 되짚는 표현이 ${recaps}회입니다 (허용 ${run.tuning.sectionRecapPhraseLimit}회). 새 반응·논평·대사로 채우는 쪽이 낫습니다`,
        );
      }
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

  private async expandSectionWithRetries(
    run: SceneGenerationRun,
    request: SectionExpansionRequest,
    options: GenerateTextOptions,
  ): Promise<CheckedSectionText> {
    let reasons: string[] = [];
    let isUnderLengthRetry: boolean = false;
    let best: {
      text: string;
      violations: readonly SectionViolation[];
      weight: number;
      distance: number;
    } = {
      text: request.section,
      violations: [],
      weight: Number.POSITIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY,
    };

    for (let attempt: number = 0; attempt <= run.tuning.sectionRetryLimit; attempt += 1) {
      const expanded: string = await run.aiService.expandSceneSection(
        {
          skeleton: run.polishedText,
          section: request.section,
          previousSection: request.previousSection,
          targetLength: request.targetLength,
          backgroundFacts: request.backgroundFacts,
          backgroundConflicts: run.backgroundFactConflicts.map(formatBackgroundFactConflict),
          sceneCoordinates: request.sceneCoordinates,
          retryReasons: reasons,
          isUnderLengthRetry,
        },
        options,
      );

      const violations: SectionViolation[] = validateExpandedSection({
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

      if (violations.length === 0) {
        return { text: expanded, violations: [] };
      }

      const weight: number = weighViolations(violations, run.tuning.violationWeights);
      const distance: number = Math.abs(expanded.length - request.targetLength);
      if (weight < best.weight || (weight === best.weight && distance < best.distance)) {
        best = { text: expanded, violations, weight, distance };
      }

      isUnderLengthRetry = violations.some((violation) => violation.kind === 'too-short');
      const thinSpots: string | undefined = isUnderLengthRetry
        ? describeThinExpansionSpots(
            findThinExpansionSpots(
              request.section,
              expanded,
              run.tuning.dialogueMinimumQuotedLength,
            ),
          )
        : undefined;
      reasons = [
        ...violations.map((violation) => violation.detail),
        ...(thinSpots === undefined ? [] : [thinSpots]),
      ];
    }

    return { text: best.text, violations: best.violations };
  }
}

import { castNameOf, type SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import {
  beatText,
  buildSkeletonContext,
  curlDialogueQuotes,
  missingBeatsViolation,
  skeletonTargetLength,
  skeletonWarningLabel,
  thinDialogueReasons,
  validatePlannedSceneBreaks,
  weighViolations,
} from '#engine/pipeline/scene/skeletonChecks';
import {
  applyPlannedSceneBreaks,
  ensureLeadingMarker,
  keepOnlyMarkers,
  planSkeletonCalls,
  renderPlannedNarrative,
  type PlannedBreakResult,
  type SceneBreakPlan,
  type SkeletonCall,
} from '#engine/pipeline/sceneBreakPlan';
import {
  countMissingSceneCoordinates,
  extractSceneCoordinates,
  hasSceneCoordinates,
  sceneCoordinatesFromBeats,
  type ExtractedSceneCoordinates,
} from '#engine/pipeline/sceneCoordinates';
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { SceneGenerationPipelineAiService } from '#engine/pipeline/sceneGenerationTypes';
import { validateSceneSkeleton, type SectionViolation } from '#engine/pipeline/sectionValidation';
import { characterCatchphrases, type GenerateTextOptions } from '@storyboard/story-ai';
import {
  formatBackgroundFactConflict,
  type SceneBeat,
  type SceneCoverageIssue,
} from '@storyboard/story-model';

export interface CombinedSkeletonDraft {
  readonly text: string;
  readonly warnings: readonly string[];
}

export type SkeletonCallInput = Parameters<
  SceneGenerationPipelineAiService['draftSceneSkeleton']
>[0];

export interface SkeletonDraft {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
  readonly missingBeats: readonly string[];
  readonly retries: number;
}

export interface SkeletonCallBatch {
  readonly base: SkeletonCallInput;
  readonly options: GenerateTextOptions;
  readonly calls: readonly SkeletonCall[];
  readonly plan: SceneBreakPlan;
  readonly targetLength: number;
}

interface BestSkeletonAttempt {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
  readonly missingBeats: readonly string[];
  readonly weight: number;
  readonly distance: number;
}

export class SkeletonDrafter {
  private readonly beats: readonly SceneBeat[];

  public constructor(private readonly run: SceneGenerationRun) {
    this.beats = run.context.scene.card?.beats ?? [];
  }

  public async draft(): Promise<void> {
    const { run, beats } = this;
    const targetLength: number | undefined = skeletonTargetLength(
      run.styleDirective,
      run.tuning.skeletonRatio,
    );
    const endState: string | undefined = run.context.scene.card?.endState;
    const base: SkeletonCallInput = {
      narrativeSource: run.narrativeSource,
      ...(run.design.length > 0 ? { design: run.design } : {}),
      personas: run.personasUsed,
      catchphrases: characterCatchphrases(run.context.characters),
      characterKnowledge: run.input.characterKnowledge,
      background: run.background,
      backgroundConflicts: run.backgroundFactConflicts.map(formatBackgroundFactConflict),
      previousContext: buildSkeletonContext(run.condensedPreviousContext, run.input.canonFactLines),
      grounding: run.context.scene.frontmatter.grounding,
      ...(targetLength === undefined ? {} : { targetLength }),
      ...(run.breakPlan === undefined ? {} : { plannedBreaks: true }),
    };
    const options: GenerateTextOptions = withAttribution(
      {
        ...buildGenerateOptions(run.providers, 'sceneSkeleton'),
        styleDirective: run.styleDirective,
      },
      { primary: run.sceneRef },
    );
    const calls: SkeletonCall[] | undefined =
      run.breakPlan === undefined
        ? undefined
        : planSkeletonCalls(run.breakPlan, targetLength, run.tuning.skeletonCharsPerCall);

    let skeleton: CombinedSkeletonDraft;
    if (calls === undefined || calls.length === 1 || targetLength === undefined) {
      run.onProgress?.('draftSkeleton', 1, 1);
      const whole: SkeletonDraft = await this.draftWithRetries(
        { ...base, ...(endState === undefined ? {} : { endState }) },
        options,
        beats.map((beat) => beatText(beat) ?? ''),
      );
      skeleton = {
        text: whole.text,
        warnings: whole.violations.map(
          (violation) => `${skeletonWarningLabel('뼈대', whole.retries)}: ${violation.detail}`,
        ),
      };
    } else {
      skeleton = await this.draftInCalls({
        base,
        options,
        calls,
        plan: run.breakPlan as SceneBreakPlan,
        targetLength,
      });
    }
    run.warnings.push(...skeleton.warnings);
    this.adopt(skeleton.text);
  }

  private async draftInCalls(batch: SkeletonCallBatch): Promise<CombinedSkeletonDraft> {
    const { run, beats } = this;
    const { base, options, calls, plan, targetLength } = batch;
    const castName: (ref: string) => string = castNameOf(run.context);
    const totalBeats: number = calls.reduce((sum, call) => sum + call.beats.length, 0);
    const endState: string | undefined = run.context.scene.card?.endState;
    const parts: string[] = [];
    const drafts: SkeletonDraft[] = [];

    for (const [index, call] of calls.entries()) {
      run.onProgress?.('draftSkeleton', index + 1, calls.length);
      const next: SkeletonCall | undefined = calls[index + 1];
      const nextBeat: string | undefined =
        next === undefined ? undefined : beatText(beats[next.beats[0] ?? -1]);

      const skeletonDraft: SkeletonDraft = await this.draftWithRetries(
        {
          ...base,
          narrativeSource: renderPlannedNarrative(beats, plan, castName, call.beats),
          targetLength: Math.round((targetLength * call.beats.length) / totalBeats),
          ...(parts.length > 0 ? { priorSkeleton: parts.join('\n\n') } : {}),
          ...(nextBeat === undefined ? {} : { nextBeat }),
          ...(next === undefined && endState !== undefined ? { endState } : {}),
        },
        options,
        call.beats.map((beat) => beatText(beats[beat]) ?? ''),
        call.markers,
      );
      parts.push(skeletonDraft.text);
      drafts.push(skeletonDraft);
      assertNotCancelled(run.shouldCancel);
    }

    const text: string = parts.join('\n\n');
    const reported: string[] = drafts.flatMap((draft) => draft.missingBeats);
    const stillMissing: Set<string> = new Set(
      reported.length === 0 ? [] : await this.findMissingBeats(reported, text, options),
    );
    const warnings: string[] = drafts.flatMap((draft, index) => {
      const label: string = skeletonWarningLabel(
        `뼈대 ${index + 1}/${calls.length}`,
        draft.retries,
      );
      const kept: SectionViolation[] = [
        ...draft.violations.filter((violation) => violation.kind !== 'missing-beats'),
        ...missingBeatsViolation(draft.missingBeats.filter((beat) => stillMissing.has(beat))),
      ];
      return kept.map((violation) => `${label}: ${violation.detail}`);
    });

    return { text, warnings };
  }

  private async draftWithRetries(
    input: SkeletonCallInput,
    options: GenerateTextOptions,
    coverageBeats: readonly string[],
    segmentNumbers?: readonly number[],
  ): Promise<SkeletonDraft> {
    const { run, beats } = this;
    const { tuning, breakPlan } = run;
    let reasons: string[] = [];
    let best: BestSkeletonAttempt | undefined;
    let retries: number = 0;

    for (let attempt: number = 0; attempt <= tuning.skeletonRetryLimit; attempt += 1) {
      retries = attempt;
      const rawResponse: string = await run.aiService.draftSceneSkeleton(
        { ...input, ...(reasons.length > 0 ? { retryReasons: reasons } : {}) },
        options,
      );
      const response: string = curlDialogueQuotes(rawResponse);
      const skeleton: string =
        segmentNumbers === undefined
          ? response
          : keepOnlyMarkers(
              segmentNumbers[0] === undefined
                ? response
                : ensureLeadingMarker(response, segmentNumbers[0]),
              segmentNumbers,
            );
      const missingBeats: string[] = await this.findMissingBeats(coverageBeats, skeleton, options);
      const violations: SectionViolation[] = [
        ...validateSceneSkeleton(skeleton, input.targetLength, tuning),
        ...validatePlannedSceneBreaks(skeleton, breakPlan, segmentNumbers),
        ...missingBeatsViolation(missingBeats),
      ];

      if (violations.length === 0) {
        return { text: skeleton, violations: [], missingBeats: [], retries };
      }

      const weight: number = weighViolations(violations, tuning.violationWeights);
      const distance: number =
        input.targetLength === undefined ? 0 : Math.abs(skeleton.length - input.targetLength);
      if (
        best === undefined ||
        weight < best.weight ||
        (weight === best.weight && distance < best.distance)
      ) {
        best = { text: skeleton, violations, missingBeats, weight, distance };
      }

      reasons = [
        ...violations.map((violation) => violation.detail),
        ...thinDialogueReasons(skeleton, violations, breakPlan, beats, tuning),
      ];
    }

    return {
      text: best?.text ?? '',
      violations: best?.violations ?? [],
      missingBeats: best?.missingBeats ?? [],
      retries,
    };
  }

  private async findMissingBeats(
    beats: readonly string[],
    skeleton: string,
    options: GenerateTextOptions,
  ): Promise<string[]> {
    if (beats.length === 0) {
      return [];
    }

    const issues: SceneCoverageIssue[] = await this.run.aiService.checkSceneCoverage(
      beats,
      skeleton,
      options,
    );
    return issues
      .filter((issue) => issue.status === 'missing')
      .map((issue) => beats[issue.index - 1])
      .filter((beat): beat is string => beat !== undefined);
  }

  public adopt(skeletonText: string): void {
    const { run } = this;
    const applied: PlannedBreakResult | undefined =
      run.breakPlan === undefined
        ? undefined
        : applyPlannedSceneBreaks(skeletonText, run.breakPlan);
    if (applied !== undefined && !applied.hasNoMarkers) {
      run.skeleton = applied.text;
      run.sceneCoordinates = {
        segments: applied.coordinates,
        isAlignedWithBreaks: true,
        beats: applied.beats,
      };
      run.polishedText = run.skeleton;
      return;
    }

    const extracted: ExtractedSceneCoordinates = extractSceneCoordinates(skeletonText);
    run.skeleton = extracted.text;
    const missingCoordinates: number = countMissingSceneCoordinates(extracted.ledger);
    if (hasSceneCoordinates(extracted.ledger) && missingCoordinates === 0) {
      run.sceneCoordinates = extracted.ledger;
    } else {
      run.sceneCoordinates = sceneCoordinatesFromBeats(
        run.context.scene.card?.beats,
        castNameOf(run.context),
      );
      if (hasSceneCoordinates(extracted.ledger)) {
        run.warnings.push(
          `뼈대: 장면 표식이 ${missingCoordinates}곳 빠져 비트의 좌표를 대신 씁니다.`,
        );
      }
    }
    run.polishedText = run.skeleton;
  }
}

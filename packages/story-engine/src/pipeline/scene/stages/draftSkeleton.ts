import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import {
  adoptSkeleton,
  beatText,
  buildSkeletonContext,
  draftSkeletonInCalls,
  draftSkeletonWithRetries,
  skeletonTargetLength,
  skeletonWarningLabel,
  type SkeletonCallInput,
  type SkeletonDraft,
} from '#engine/pipeline/scene/skeletonDrafting';
import {
  planSkeletonCalls,
  type SceneBreakPlan,
  type SkeletonCall,
} from '#engine/pipeline/sceneBreakPlan';
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import { characterCatchphrases, type GenerateTextOptions } from '@storyboard/story-ai';
import { formatBackgroundFactConflict, type SceneBeat } from '@storyboard/story-model';

export class DraftSkeletonStage implements ISceneStage {
  public readonly id: SceneStageId = 'draftSkeleton';

  public async run(run: SceneGenerationRun): Promise<void> {
    const beats: SceneBeat[] = run.context.scene.card?.beats ?? [];
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

    let skeleton: { readonly text: string; readonly warnings: readonly string[] };
    if (calls === undefined || calls.length === 1 || targetLength === undefined) {
      run.onProgress?.('draftSkeleton', 1, 1);
      const whole: SkeletonDraft = await draftSkeletonWithRetries(
        run.aiService,
        { ...base, ...(endState === undefined ? {} : { endState }) },
        options,
        run.tuning.skeletonRetryLimit,
        run.tuning,
        run.breakPlan,
        beats,
        beats.map((beat) => beatText(beat) ?? ''),
      );
      skeleton = {
        text: whole.text,
        warnings: whole.violations.map(
          (violation) => `${skeletonWarningLabel('뼈대', whole.retries)}: ${violation.detail}`,
        ),
      };
    } else {
      skeleton = await draftSkeletonInCalls({
        run,
        base,
        options,
        calls,
        plan: run.breakPlan as SceneBreakPlan,
        beats,
        targetLength,
      });
    }
    run.warnings.push(...skeleton.warnings);
    adoptSkeleton(run, skeleton.text);
    assertNotCancelled(run.shouldCancel);
  }
}

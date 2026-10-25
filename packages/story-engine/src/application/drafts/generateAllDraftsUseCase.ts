import type { StoryUri } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { SceneGenerationPipelineStage } from '#engine/pipeline/sceneGenerationTypes';
import type { GenerateDraftResult, GenerateDraftUseCase } from './generateDraftUseCase';
import type { ReviseAfterGenerateGate } from './reviseAfterGenerateGate';
import { describeReviseOutcome, type ReviseDraftWorkflowResult } from './reviseDraftUseCase';
import type { IUseCase } from '#engine/application/useCase';

export interface ISceneBatchRepository {
  listStoryboardScenes(): Promise<BatchSceneList>;
}

export type BatchSceneList = {
  readonly projectCount: number;
  readonly scenes: readonly StoryUri[];
};

export type GenerateAllDraftsProgress = {
  readonly current: number;
  readonly kind: 'pipeline' | 'prepared' | 'revising' | 'saving';
  readonly label: string;
  readonly stage?: SceneGenerationPipelineStage;
  readonly stageCurrent?: number;
  readonly stageTotal?: number;
  readonly total: number;
};

export type GenerateAllDraftsSummary = {
  readonly cacheHits: number;
  readonly failureLabels: readonly string[];
  readonly failures: number;
  readonly generated: number;
  readonly sceneCount: number;
  readonly pausedWithRemaining?: number;
};

export type GenerateAllDraftsResult =
  | { readonly kind: 'no_projects'; readonly ok: false }
  | { readonly kind: 'no_scenes'; readonly ok: false }
  | { readonly kind: 'completed'; readonly ok: true; readonly summary: GenerateAllDraftsSummary };

export type GenerateAllDraftsOptions = {
  readonly onProgress?: (progress: GenerateAllDraftsProgress) => void;
  readonly shouldCancel?: () => boolean;
  readonly shouldPause?: () => boolean;
};

export interface GenerateAllDraftsUseCaseDependencies {
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly logger: IStoryboardLogger;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly sceneRepository: ISceneBatchRepository;
}

export class GenerateAllDraftsUseCase implements IUseCase<
  GenerateAllDraftsOptions,
  GenerateAllDraftsResult
> {
  public constructor(private readonly deps: GenerateAllDraftsUseCaseDependencies) {}

  public async execute(options: GenerateAllDraftsOptions = {}): Promise<GenerateAllDraftsResult> {
    const scenes: BatchSceneList = await this.deps.sceneRepository.listStoryboardScenes();

    if (scenes.projectCount === 0) {
      return { kind: 'no_projects', ok: false };
    }
    if (scenes.scenes.length === 0) {
      return { kind: 'no_scenes', ok: false };
    }

    let generated: number = 0;
    let cacheHits: number = 0;
    let failures: number = 0;
    const failureLabels: string[] = [];
    const total: number = scenes.scenes.length;
    let pausedWithRemaining: number | undefined;

    for (const [index, sceneUri] of scenes.scenes.entries()) {
      if (options.shouldCancel?.()) {
        break;
      }

      if (options.shouldPause?.()) {
        pausedWithRemaining = total - index;
        break;
      }

      const current: number = index + 1;
      const label: string = sceneUri.path.split('/').at(-1) ?? sceneUri.fsPath;
      options.onProgress?.({ current, kind: 'prepared', label, total });
      const draftResult: GenerateDraftResult = await this.deps.generateDraftUseCase.execute({
        sceneUri,
        force: false,
        suppressLoggerPanel: true,
        onPipelineProgress: (stage, stageCurrent, stageTotal) => {
          if (!options.shouldCancel?.()) {
            options.onProgress?.({
              current,
              kind: 'pipeline',
              label,
              stage,
              stageCurrent,
              stageTotal,
              total,
            });
          }
        },
        onSaving: () => {
          if (!options.shouldCancel?.())
            options.onProgress?.({ current, kind: 'saving', label, total });
        },
        shouldCancel: options.shouldCancel,
      });

      if (draftResult.ok) {
        if (draftResult.kind === 'cache_hit') cacheHits += 1;
        else {
          generated += 1;
          if (draftResult.warnings.length > 0) {
            this.deps.logger.warn(`${label}: ${draftResult.warnings.join(' / ')}`);
          }
          const revised: ReviseDraftWorkflowResult | undefined =
            await this.deps.reviseAfterGenerateGate.maybeRunAfterGenerate(sceneUri, {
              onWillRun: () => options.onProgress?.({ current, kind: 'revising', label, total }),
              shouldCancel: options.shouldCancel,
            });
          const reviseWarning: string | undefined =
            revised && describeReviseOutcome(revised).warning;
          if (reviseWarning) {
            this.deps.logger.warn(`${label}: ${reviseWarning}`);
          }
        }
        continue;
      }

      if (draftResult.kind === 'cancelled') break;
      if (draftResult.reason === 'usage-limit') {
        this.deps.logger.warn(`${label}: ${draftResult.message}`);
        pausedWithRemaining = total - index;
        break;
      }
      failures += 1;
      if (failureLabels.length < 5) failureLabels.push(`${label}: ${draftResult.message}`);
      this.deps.logger.error(
        `Draft generation failed for ${label}`,
        new Error(draftResult.message),
      );
    }

    return {
      kind: 'completed',
      ok: true,
      summary: {
        generated,
        cacheHits,
        failures,
        failureLabels,
        sceneCount: total,
        ...(pausedWithRemaining === undefined ? {} : { pausedWithRemaining }),
      },
    };
  }
}

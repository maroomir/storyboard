import type { HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import type { SceneGenerationPipelineStage } from '#engine/pipeline/sceneGenerationTypes';
import type { GenerateDraftResult, GenerateDraftUseCase } from './generateDraftUseCase';
import type { ReviseAfterGenerateGate } from './reviseAfterGenerateGate';
import { describeReviseOutcome, type ReviseDraftWorkflowResult } from './reviseDraftUseCase';
import type { IUseCase } from '#engine/application/useCase';
import type { BatchSceneList } from '#engine/application/drafts/draftRepositories';
import type { StoryUri } from '@storyboard/story-model';

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

export interface GenerateAllDraftsCollaborators {
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
}

const maxListedFailureLabels: number = 5;

interface BatchScenePosition {
  readonly current: number;
  readonly label: string;
  readonly remaining: number;
  readonly total: number;
}

type FailedDraftResult = Extract<GenerateDraftResult, { readonly ok: false }>;

function describeBatchScenePosition(
  sceneUri: StoryUri,
  index: number,
  total: number,
): BatchScenePosition {
  return {
    current: index + 1,
    label: sceneUri.path.split('/').at(-1) ?? sceneUri.fsPath,
    remaining: total - index,
    total,
  };
}

class DraftBatchTally {
  private generated: number = 0;
  private cacheHits: number = 0;
  private failures: number = 0;
  private readonly failureLabels: string[] = [];
  private pausedWithRemaining: number | undefined;

  public constructor(private readonly sceneCount: number) {}

  public recordCacheHit(): void {
    this.cacheHits += 1;
  }

  public recordGenerated(): void {
    this.generated += 1;
  }

  public recordFailure(failureLabel: string): void {
    this.failures += 1;
    if (this.failureLabels.length < maxListedFailureLabels) this.failureLabels.push(failureLabel);
  }

  public recordPause(remaining: number): void {
    this.pausedWithRemaining = remaining;
  }

  public toResult(): GenerateAllDraftsResult {
    const pausedWithRemaining: number | undefined = this.pausedWithRemaining;

    return {
      kind: 'completed',
      ok: true,
      summary: {
        generated: this.generated,
        cacheHits: this.cacheHits,
        failures: this.failures,
        failureLabels: this.failureLabels,
        sceneCount: this.sceneCount,
        ...(pausedWithRemaining === undefined ? {} : { pausedWithRemaining }),
      },
    };
  }
}

export class GenerateAllDraftsUseCase implements IUseCase<
  GenerateAllDraftsOptions,
  GenerateAllDraftsResult
> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly repositories: WorkspaceRepositories,
    private readonly collaborators: GenerateAllDraftsCollaborators,
  ) {}

  public async execute(options: GenerateAllDraftsOptions = {}): Promise<GenerateAllDraftsResult> {
    const scenes: BatchSceneList = await this.repositories.sceneBatches.listStoryboardScenes();

    if (scenes.projectCount === 0) {
      return { kind: 'no_projects', ok: false };
    }
    if (scenes.scenes.length === 0) {
      return { kind: 'no_scenes', ok: false };
    }

    const total: number = scenes.scenes.length;
    const tally: DraftBatchTally = new DraftBatchTally(total);

    for (const [index, sceneUri] of scenes.scenes.entries()) {
      if (options.shouldCancel?.()) {
        break;
      }

      if (options.shouldPause?.()) {
        tally.recordPause(total - index);
        break;
      }

      const position: BatchScenePosition = describeBatchScenePosition(sceneUri, index, total);
      const shouldContinue: boolean = await this.generateScene(sceneUri, position, options, tally);
      if (!shouldContinue) break;
    }

    return tally.toResult();
  }

  private async generateScene(
    sceneUri: StoryUri,
    position: BatchScenePosition,
    options: GenerateAllDraftsOptions,
    tally: DraftBatchTally,
  ): Promise<boolean> {
    const { current, label, total } = position;
    options.onProgress?.({ current, kind: 'prepared', label, total });
    const draftResult: GenerateDraftResult = await this.requestDraft(sceneUri, position, options);

    if (!draftResult.ok) {
      return this.recordFailedDraft(draftResult, position, tally);
    }

    if (draftResult.kind === 'cache_hit') tally.recordCacheHit();
    else await this.recordGeneratedDraft(sceneUri, draftResult.warnings, position, options, tally);
    return true;
  }

  private async requestDraft(
    sceneUri: StoryUri,
    position: BatchScenePosition,
    options: GenerateAllDraftsOptions,
  ): Promise<GenerateDraftResult> {
    const { current, label, total } = position;

    return await this.collaborators.generateDraftUseCase.execute({
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
  }

  private async recordGeneratedDraft(
    sceneUri: StoryUri,
    warnings: readonly string[],
    position: BatchScenePosition,
    options: GenerateAllDraftsOptions,
    tally: DraftBatchTally,
  ): Promise<void> {
    const { current, label, total } = position;
    tally.recordGenerated();
    if (warnings.length > 0) {
      this.host.logger.warn(`${label}: ${warnings.join(' / ')}`);
    }

    const revised: ReviseDraftWorkflowResult | undefined =
      await this.collaborators.reviseAfterGenerateGate.maybeRunAfterGenerate(sceneUri, {
        onWillRun: () => options.onProgress?.({ current, kind: 'revising', label, total }),
        shouldCancel: options.shouldCancel,
      });
    const reviseWarning: string | undefined = revised && describeReviseOutcome(revised).warning;
    if (reviseWarning) {
      this.host.logger.warn(`${label}: ${reviseWarning}`);
    }
  }

  private recordFailedDraft(
    draftResult: FailedDraftResult,
    position: BatchScenePosition,
    tally: DraftBatchTally,
  ): boolean {
    const { label } = position;

    if (draftResult.kind === 'cancelled') return false;
    if (draftResult.reason === 'usage-limit') {
      this.host.logger.warn(`${label}: ${draftResult.message}`);
      tally.recordPause(position.remaining);
      return false;
    }

    tally.recordFailure(`${label}: ${draftResult.message}`);
    this.host.logger.error(`Draft generation failed for ${label}`, new Error(draftResult.message));
    return true;
  }
}

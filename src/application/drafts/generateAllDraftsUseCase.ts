import type * as vscode from 'vscode';

import type { StoryboardLogger } from '../../core/logger';
import type { SceneGenerationPipelineStage } from '../pipelines/sceneGenerationPipeline';
import type { GenerateDraftUseCase } from './generateDraftUseCase';
import type { ReviseAfterGenerateGate } from './reviseAfterGenerateGate';

export interface ISceneBatchRepository {
  listStoryboardScenes(): Promise<BatchSceneList>;
}

export type BatchSceneList = {
  readonly projectCount: number;
  readonly scenes: readonly vscode.Uri[];
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
};

export type GenerateAllDraftsResult =
  | { readonly kind: 'no_projects'; readonly ok: false }
  | { readonly kind: 'no_scenes'; readonly ok: false }
  | { readonly kind: 'completed'; readonly ok: true; readonly summary: GenerateAllDraftsSummary };

export type GenerateAllDraftsOptions = {
  readonly onProgress?: (progress: GenerateAllDraftsProgress) => void;
  readonly shouldCancel?: () => boolean;
};

export class GenerateAllDraftsUseCase {
  public constructor(
    private readonly generateDraftUseCase: GenerateDraftUseCase,
    private readonly logger: StoryboardLogger,
    private readonly reviseAfterGenerateGate: ReviseAfterGenerateGate,
    private readonly sceneRepository: ISceneBatchRepository,
  ) {}

  public async execute(options: GenerateAllDraftsOptions = {}): Promise<GenerateAllDraftsResult> {
    const scenes = await this.sceneRepository.listStoryboardScenes();

    if (scenes.projectCount === 0) {
      return { kind: 'no_projects', ok: false };
    }
    if (scenes.scenes.length === 0) {
      return { kind: 'no_scenes', ok: false };
    }

    let generated = 0;
    let cacheHits = 0;
    let failures = 0;
    const failureLabels: string[] = [];
    const total = scenes.scenes.length;

    for (const [index, sceneUri] of scenes.scenes.entries()) {
      if (options.shouldCancel?.()) {
        break;
      }

      const current = index + 1;
      const label = sceneUri.path.split('/').at(-1) ?? sceneUri.fsPath;
      options.onProgress?.({ current, kind: 'prepared', label, total });
      const result = await this.generateDraftUseCase.execute(sceneUri, {
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

      if (result.ok) {
        if (result.kind === 'cache_hit') cacheHits += 1;
        else {
          generated += 1;
          await this.reviseAfterGenerateGate.maybeRunAfterGenerate(sceneUri, {
            onWillRun: () => options.onProgress?.({ current, kind: 'revising', label, total }),
            shouldCancel: options.shouldCancel,
          });
        }
        continue;
      }

      if (result.kind === 'cancelled') break;
      failures += 1;
      if (failureLabels.length < 5) failureLabels.push(`${label}: ${result.message}`);
      this.logger.error(`Draft generation failed for ${label}`, new Error(result.message));
    }

    return {
      kind: 'completed',
      ok: true,
      summary: { generated, cacheHits, failures, failureLabels, sceneCount: total },
    };
  }
}

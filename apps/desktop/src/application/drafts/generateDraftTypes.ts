import type * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import type { IFileSystem } from '../ports/fileSystem';
import type {
  IDraftRepository,
  IProjectRepository,
  ISceneCacheRepository,
  ISceneRepository,
} from '../ports/repositories';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import type { ConfigBridge } from '../../infrastructure/settings/ConfigBridge';
import type { TraitsUpdateSummary } from '../../infrastructure/ai/traitsUpdater';
import type { PostGenerationUpdateManager } from '../../infrastructure/ai/PostGenerationUpdateManager';
import type { SceneGenerationPipelineStage } from '../pipelines/sceneGenerationPipeline';

export interface GenerateDraftUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly configBridge: ConfigBridge;
  readonly draftRepository: IDraftRepository;
  readonly fileSystem: IFileSystem;
  readonly logger: StoryboardLogger;
  readonly postGenerationUpdates?: PostGenerationUpdateManager;
  readonly projectRepository: IProjectRepository;
  readonly sceneCacheRepository: ISceneCacheRepository;
  readonly sceneRepository: ISceneRepository;
}

export interface GenerateDraftRequest {
  readonly force: boolean;
  readonly onPipelineProgress?: (
    stage: SceneGenerationPipelineStage,
    current: number,
    total: number,
  ) => void;
  readonly onSaving?: () => void;
  readonly shouldCancel?: () => boolean;
  readonly suppressLoggerPanel?: boolean;
  readonly onTraitsUpdateComplete?: (summary: TraitsUpdateSummary) => void;
}

export type GenerateDraftResult =
  | { ok: true; kind: 'generated'; draftUri: vscode.Uri }
  | { ok: true; kind: 'cache_hit'; draftUri: vscode.Uri }
  | { ok: false; kind: 'failed'; message: string }
  | { ok: false; kind: 'cancelled' };

export type GenerateDraftWorkflowOptions = GenerateDraftUseCaseDependencies & GenerateDraftRequest;

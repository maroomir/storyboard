import type { AiGateway } from '../ai/aiGateway';
import type { StoryUri } from '@storyboard/story-format';
import type { WorkspaceLocator } from '../../ports/workspaceLocator';
import type { IFileSystem } from '../../ports/fileSystem';
import type {
  IDraftRepository,
  IProjectRepository,
  ISceneCacheRepository,
  ISceneRepository,
} from '../../ports/repositories';
import type { StoryboardLogger } from '../../ports/logger';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { TraitsUpdateSummary } from '../../ai/traitsUpdater';
import type { PostGenerationUpdateManager } from '../../ai/PostGenerationUpdateManager';
import type { SceneGenerationPipelineStage } from '@storyboard/story-pipeline';
import type { SceneGrounding, SceneGroundingFieldKey } from '@storyboard/story-format';

// 승인 UI는 presentation이 구현한다. undefined를 돌려주면 생성을 취소한다.
export type ConfirmSceneGrounding = (input: {
  readonly sceneStem: string;
  readonly grounding: SceneGrounding;
  readonly proposedFields: readonly SceneGroundingFieldKey[];
}) => Promise<SceneGrounding | undefined>;

export interface GenerateDraftUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly configBridge: ConfigBridge;
  readonly draftRepository: IDraftRepository;
  readonly fileSystem: IFileSystem;
  readonly generator: string;
  readonly logger: StoryboardLogger;
  readonly postGenerationUpdates?: PostGenerationUpdateManager;
  readonly projectRepository: IProjectRepository;
  readonly sceneCacheRepository: ISceneCacheRepository;
  readonly sceneRepository: ISceneRepository;
  readonly workspaceLocator: WorkspaceLocator;
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
  readonly confirmSceneGrounding?: ConfirmSceneGrounding;
  // Leave the scene's grounding exactly as authored: propose nothing, write nothing, generate with
  // what is already there. Distinct from a declined approval, which cancels the run.
  readonly skipSceneGrounding?: boolean;
  readonly suppressLoggerPanel?: boolean;
  readonly onTraitsUpdateComplete?: (summary: TraitsUpdateSummary) => void;
}

export type GenerateDraftResult =
  | { ok: true; kind: 'generated'; draftUri: StoryUri }
  | { ok: true; kind: 'cache_hit'; draftUri: StoryUri }
  | { ok: false; kind: 'failed'; message: string }
  | { ok: false; kind: 'cancelled' };

export type GenerateDraftWorkflowOptions = GenerateDraftUseCaseDependencies & GenerateDraftRequest;

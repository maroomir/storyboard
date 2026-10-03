import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { StoryUri, SceneGrounding, SceneGroundingFieldKey } from '@storyboard/story-model';
import type { IWorkspaceLocator } from '#engine/ports/workspaceLocator';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type {
  IDraftRepository,
  IProjectRepository,
  ISceneCacheRepository,
  ISceneRepository,
} from '#engine/application/drafts/draftRepositories';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { TraitsUpdateSummary } from '#engine/ai/traitsUpdater';
import type { PostGenerationUpdateManager } from '#engine/ai/PostGenerationUpdateManager';
import type { SceneGenerationPipelineStage } from '@storyboard/story-pipeline';

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
  readonly logger: IStoryboardLogger;
  readonly postGenerationUpdates?: PostGenerationUpdateManager;
  readonly projectRepository: IProjectRepository;
  readonly sceneCacheRepository: ISceneCacheRepository;
  readonly sceneRepository: ISceneRepository;
  readonly workspaceLocator: IWorkspaceLocator;
}

export interface GenerateDraftRequest {
  readonly sceneUri: StoryUri;
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
  | {
      readonly ok: true;
      readonly kind: 'generated';
      readonly draftUri: StoryUri;
      readonly warnings: readonly string[];
    }
  | { readonly ok: true; readonly kind: 'cache_hit'; readonly draftUri: StoryUri }
  | { readonly ok: false; readonly kind: 'failed'; readonly message: string }
  | { readonly ok: false; readonly kind: 'cancelled' };

export type GenerateDraftWorkflowOptions = GenerateDraftUseCaseDependencies & GenerateDraftRequest;

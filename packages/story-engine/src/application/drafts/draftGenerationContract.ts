import type { StoryUri, SceneGrounding, SceneGroundingFieldKey } from '@storyboard/story-model';
import type { TraitsUpdateSummary } from '#engine/ai/traitsUpdater';
import type { PostGenerationUpdateManager } from '#engine/ai/PostGenerationUpdateManager';
import type { SceneGenerationPipelineStage } from '#engine/pipeline/sceneGenerationTypes';
import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';

export function emptyDraftBodyMessage(sceneStem: string): string {
  return `모델이 빈 본문을 돌려줘 초안을 저장하지 않았습니다. 기존 초안은 그대로입니다: ${sceneStem}`;
}

export type ConfirmSceneGrounding = (input: {
  readonly sceneStem: string;
  readonly grounding: SceneGrounding;
  readonly proposedFields: readonly SceneGroundingFieldKey[];
}) => Promise<SceneGrounding | undefined>;

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
  readonly skipSceneGrounding?: boolean;
  readonly skipSceneBeats?: boolean;
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
  | {
      readonly ok: false;
      readonly kind: 'failed';
      readonly message: string;
      readonly reason?: 'usage-limit';
    }
  | { readonly ok: false; readonly kind: 'cancelled' };

export interface GenerateDraftServices {
  readonly host: HostAdapters;
  readonly ai: AiServices;
  readonly repositories: WorkspaceRepositories;
  readonly postGenerationUpdates?: PostGenerationUpdateManager;
}

export type GenerateDraftWorkflowOptions = GenerateDraftServices & GenerateDraftRequest;

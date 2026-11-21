import type { StoryUri } from '@storyboard/story-model';
import type {
  SceneGenerationPipelineStage,
  SceneWarning,
} from '#engine/pipeline/sceneGenerationTypes';

export function emptyDraftBodyMessage(sceneStem: string): string {
  return `모델이 빈 본문을 돌려줘 초안을 저장하지 않았습니다. 기존 초안은 그대로입니다: ${sceneStem}`;
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
  readonly skipSceneBeats?: boolean;
  readonly suppressLoggerPanel?: boolean;
  readonly reviseFollows?: ReviseFollowing;
}

export type ReviseFollowing = 'always' | 'when-enabled';

export interface DraftWarning extends SceneWarning {
  readonly stage?: string;
}

export function draftWarningMessages(warnings: readonly DraftWarning[]): readonly string[] {
  return warnings.map((warning) => warning.message);
}

export type GenerateDraftResult =
  | {
      readonly ok: true;
      readonly kind: 'generated';
      readonly draftUri: StoryUri;
      readonly warnings: readonly DraftWarning[];
      readonly traceRunId?: string;
    }
  | { readonly ok: true; readonly kind: 'cache_hit'; readonly draftUri: StoryUri }
  | {
      readonly ok: false;
      readonly kind: 'failed';
      readonly message: string;
      readonly reason?: 'usage-limit';
    }
  | { readonly ok: false; readonly kind: 'cancelled' };

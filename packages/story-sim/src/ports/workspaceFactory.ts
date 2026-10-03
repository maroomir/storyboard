import type { UsageRecord } from '@storyboard/story-model';
import type { SceneGenerationTuning } from '@storyboard/story-pipeline';

// story-sim 은 CLI 컨테이너를 모른다. 한 지점을 돌릴 워크스페이스를 여는 일만 포트로 맡기고,
// apps/cli 가 그것을 제품 경로(GenerateDraftUseCase)로 구현한다.

export interface SceneGenerationOutcome {
  readonly ok: boolean;
  readonly kind: string;
  readonly message?: string;
  readonly warnings: readonly string[];
}

export interface SimSceneGenerator {
  readonly workspacePath: string;
  readonly generate: (sceneStem: string) => Promise<SceneGenerationOutcome>;
  // 지난 호출 이후 쌓인 사용량을 비우며 돌려준다. 씬 단위로 비용을 가르기 위해서다.
  readonly drainUsage: () => readonly UsageRecord[];
  readonly readDraft: (sceneStem: string) => Promise<string>;
}

export interface OpenWorkspaceInput {
  readonly workspacePath: string;
  readonly tuning: SceneGenerationTuning;
  readonly sectionOutputLimit?: number;
}

export interface ISimWorkspaceFactory {
  readonly open: (input: OpenWorkspaceInput) => Promise<SimSceneGenerator>;
}

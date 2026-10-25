import type { UsageRecord } from '@storyboard/story-model';
import type { SceneGenerationTuning } from '@storyboard/story-engine';

export interface SceneGenerationOutcome {
  readonly ok: boolean;
  readonly kind: string;
  readonly message?: string;
  readonly warnings: readonly string[];
}

export interface SimSceneGenerator {
  readonly workspacePath: string;
  readonly generate: (sceneStem: string) => Promise<SceneGenerationOutcome>;
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

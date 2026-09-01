import type { StoryUri } from '@storyboard/story-format';
import type { SceneFile, StoryboardCard, StoryboardProject } from '@storyboard/story-format';
export interface StoryFileSnapshot {
  readonly uri: StoryUri;
  readonly sha256: string;
  readonly kind?: 'file' | 'directory';
}

export interface StoryFeatureSource {
  readonly workspaceRoot: StoryUri;
  readonly project: StoryboardProject;
  readonly scenes: readonly SceneFile[];
  readonly cards: readonly StoryboardCard[];
  readonly canonText: string;
  readonly snapshots: readonly StoryFileSnapshot[];
}

export interface IStoryFeatureRepository {
  load(workspaceRoot: StoryUri): Promise<StoryFeatureSource>;
  hasCurrentSnapshots(snapshots: readonly StoryFileSnapshot[]): Promise<boolean>;
}

export type StoryFeatureSourceErrorCode =
  | 'invalid-scene'
  | 'invalid-card'
  | 'source-read-failed'
  | 'no-valid-scenes'
  | 'card-name-conflict'
  | 'unknown-scene-reference'
  | 'unknown-card-reference'
  | 'duplicate-scene-slug'
  | 'invalid-scene-filename';

export class StoryFeatureSourceError extends Error {
  public constructor(
    public readonly code: StoryFeatureSourceErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StoryFeatureSourceError';
  }
}

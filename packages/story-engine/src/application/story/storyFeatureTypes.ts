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

export class StoryFeatureSourceError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'StoryFeatureSourceError';
  }
}

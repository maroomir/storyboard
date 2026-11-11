import type {
  StoryUri,
  Draft,
  SceneBeat,
  SceneFile,
  StoryboardProject,
  SceneCacheRecord,
} from '@storyboard/story-model';
export interface IProjectRepository {
  read(uri: StoryUri): Promise<StoryboardProject>;
  write(uri: StoryUri, project: StoryboardProject): Promise<void>;
}

export interface ISceneRepository {
  read(uri: StoryUri): Promise<SceneFile>;
  writeBeats(uri: StoryUri, beats: readonly SceneBeat[]): Promise<void>;
}

export interface IDraftRepository {
  write(uri: StoryUri, draft: Draft): Promise<void>;
}

export interface ISceneCacheRepository {
  read(uri: StoryUri): Promise<SceneCacheRecord>;
  write(uri: StoryUri, record: SceneCacheRecord): Promise<void>;
  ensureDirectory(uri: StoryUri): Promise<void>;
}

export interface ISceneBatchRepository {
  listStoryboardScenes(): Promise<BatchSceneList>;
}

export type BatchSceneList = {
  readonly projectCount: number;
  readonly scenes: readonly StoryUri[];
};

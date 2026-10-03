// The repository ports the draft use cases consume; persistence implements them.
import type {
  StoryUri,
  Draft,
  SceneFile,
  SceneGrounding,
  StoryboardProject,
  SceneCacheRecord,
} from '@storyboard/story-model';
export interface IProjectRepository {
  read(uri: StoryUri): Promise<StoryboardProject>;
}

export interface ISceneRepository {
  read(uri: StoryUri, fileName: string): Promise<SceneFile>;
  writeGrounding(uri: StoryUri, grounding: SceneGrounding): Promise<void>;
  writeBeats(uri: StoryUri, beats: readonly string[]): Promise<void>;
}

export interface IDraftRepository {
  write(uri: StoryUri, draft: Draft): Promise<void>;
}

export interface ISceneCacheRepository {
  read(uri: StoryUri): Promise<SceneCacheRecord>;
  write(uri: StoryUri, record: SceneCacheRecord): Promise<void>;
  ensureDirectory(uri: StoryUri): Promise<void>;
}

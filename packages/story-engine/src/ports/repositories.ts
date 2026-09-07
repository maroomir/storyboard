import type { StoryUri } from '@storyboard/story-format';
import type { Draft, SceneFile, SceneGrounding, StoryboardProject } from '@storyboard/story-format';
import type { SceneCacheRecord } from '#engine/domain/files/sceneCache';
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

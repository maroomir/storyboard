import type { Draft, SceneFile, SceneGrounding, StoryboardProject } from '@storyboard/story-format';
import type { SceneCacheRecord } from '../domain/files/sceneCache';
export interface IProjectRepository {
  read(uri: unknown): Promise<StoryboardProject>;
}

export interface ISceneRepository {
  read(uri: unknown, fileName: string): Promise<SceneFile>;
  writeGrounding(uri: unknown, grounding: SceneGrounding): Promise<void>;
}

export interface IDraftRepository {
  write(uri: unknown, draft: Draft): Promise<void>;
}

export interface ISceneCacheRepository {
  read(uri: unknown): Promise<SceneCacheRecord>;
  write(uri: unknown, record: SceneCacheRecord): Promise<void>;
  ensureDirectory(uri: unknown): Promise<void>;
}

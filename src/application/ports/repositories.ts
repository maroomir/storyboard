import type { Draft } from '../../domain/Draft';
import type { SceneCacheRecord } from '../../files/sceneCache';
import type { StoryboardProject } from '../../shared/project';
import type { SceneFile } from '../../shared/scene';

export interface IProjectRepository {
  read(uri: unknown): Promise<StoryboardProject>;
}

export interface ISceneRepository {
  read(uri: unknown, fileName: string): Promise<SceneFile>;
}

export interface IDraftRepository {
  write(uri: unknown, draft: Draft): Promise<void>;
}

export interface ISceneCacheRepository {
  read(uri: unknown): Promise<SceneCacheRecord>;
  write(uri: unknown, record: SceneCacheRecord): Promise<void>;
  ensureDirectory(uri: unknown): Promise<void>;
}

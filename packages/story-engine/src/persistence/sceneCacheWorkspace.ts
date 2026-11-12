import {
  joinStoryPath,
  sceneCacheRelativeDirectory,
  sceneGenerationCacheRelativePath,
  sceneReviseRoundsRelativePath,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

export interface SceneCacheKey {
  readonly sceneId?: string;
  readonly stem: string;
}

function cacheKeyOf(scene: SceneCacheKey): string {
  return scene.sceneId ?? scene.stem;
}

function workspacePathOf(paths: StoryboardProjectPaths, relativePath: string): StoryUri {
  return joinStoryPath(paths.workspaceRoot, ...relativePath.split('/'));
}

export function sceneCacheDirectoryPath(paths: StoryboardProjectPaths, scene: SceneCacheKey): StoryUri {
  return workspacePathOf(paths, sceneCacheRelativeDirectory(cacheKeyOf(scene)));
}

export function sceneCacheFilePath(paths: StoryboardProjectPaths, scene: SceneCacheKey): StoryUri {
  return workspacePathOf(paths, sceneGenerationCacheRelativePath(cacheKeyOf(scene)));
}

export function sceneReviseRoundsPath(paths: StoryboardProjectPaths, scene: SceneCacheKey): StoryUri {
  return workspacePathOf(paths, sceneReviseRoundsRelativePath(cacheKeyOf(scene)));
}

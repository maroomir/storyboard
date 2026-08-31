import { joinStoryPath, type StoryUri } from '../paths/storyUri';
import type { StoryboardProjectPaths } from '../paths/projectPaths';

export function sceneCacheFilePath(paths: StoryboardProjectPaths, sceneStem: string): StoryUri {
  return joinStoryPath(paths.sceneCacheDirectory, `${sceneStem}.json`);
}

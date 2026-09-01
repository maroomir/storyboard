import { joinStoryPath, type StoryUri } from '@storyboard/story-format';
import type { StoryboardProjectPaths } from '#engine/paths/projectPaths';

export function sceneCacheFilePath(paths: StoryboardProjectPaths, sceneStem: string): StoryUri {
  return joinStoryPath(paths.sceneCacheDirectory, `${sceneStem}.json`);
}

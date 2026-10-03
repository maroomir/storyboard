import { joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { StoryboardProjectPaths } from '@storyboard/story-model';

export function sceneCacheFilePath(paths: StoryboardProjectPaths, sceneStem: string): StoryUri {
  return joinStoryPath(paths.sceneCacheDirectory, `${sceneStem}.json`);
}

import { joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { StoryboardProjectPaths } from '@storyboard/story-model';

export function bibleCandidateFilePath(paths: StoryboardProjectPaths, sceneStem: string): StoryUri {
  return joinStoryPath(paths.bibleCacheDirectory, `${sceneStem}.json`);
}

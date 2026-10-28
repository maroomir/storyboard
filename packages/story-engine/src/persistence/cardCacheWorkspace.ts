import { joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { StoryboardProjectPaths } from '@storyboard/story-model';

export function cardCandidateFilePath(paths: StoryboardProjectPaths, sceneStem: string): StoryUri {
  return joinStoryPath(paths.cardCacheDirectory, `${sceneStem}.json`);
}

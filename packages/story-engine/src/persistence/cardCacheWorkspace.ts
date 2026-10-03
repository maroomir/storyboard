import { joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { StoryboardProjectPaths } from '#engine/paths/projectPaths';

export async function ensureCardCacheDirectory(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<void> {
  await fs.createDirectory(paths.cardCacheDirectory);
}

export function cardCandidateFilePath(paths: StoryboardProjectPaths, sceneStem: string): StoryUri {
  return joinStoryPath(paths.cardCacheDirectory, `${sceneStem}.json`);
}

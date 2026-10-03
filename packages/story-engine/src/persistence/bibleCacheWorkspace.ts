import { joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { StoryboardProjectPaths } from '#engine/paths/projectPaths';

export async function ensureBibleCacheDirectory(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<void> {
  await fs.createDirectory(paths.bibleCacheDirectory);
}

export function bibleCandidateFilePath(paths: StoryboardProjectPaths, sceneStem: string): StoryUri {
  return joinStoryPath(paths.bibleCacheDirectory, `${sceneStem}.json`);
}

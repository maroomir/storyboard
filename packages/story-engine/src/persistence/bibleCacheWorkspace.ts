import { joinStoryPath, type StoryUri } from '../paths/storyUri';
import type { IFileSystem } from '../ports/fileSystem';
import type { StoryboardProjectPaths } from '../paths/projectPaths';

export async function ensureBibleCacheDirectory(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<void> {
  await fs.createDirectory(paths.bibleCacheDirectory);
}

export function bibleCandidateFilePath(paths: StoryboardProjectPaths, sceneStem: string): StoryUri {
  return joinStoryPath(paths.bibleCacheDirectory, `${sceneStem}.json`);
}

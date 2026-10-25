import { joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';

export async function listCardFileUris(fs: IFileSystem, directory: StoryUri): Promise<StoryUri[]> {
  let names: readonly string[];

  try {
    names = await fs.listFileNames(directory);
  } catch {
    return [];
  }

  return names
    .filter((name) => name.endsWith('.card'))
    .sort()
    .map((name) => joinStoryPath(directory, name));
}

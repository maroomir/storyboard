import { joinStoryPath, type StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '../ports/fileSystem';

// The `character/*.card` glob the extension used to hand to VSCode's file search. Cards are always
// direct children of their directory, so a listing is the whole of it.
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

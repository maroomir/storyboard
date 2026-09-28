import { joinStoryPath, type StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';

// The plain files in a directory, by name. A directory that is missing or unreadable lists as
// empty: for every caller here "no files yet" and "no directory yet" mean the same thing.
export async function listDirectoryFileNames(
  fileSystem: IFileSystem,
  directory: StoryUri,
  isEligible: (name: string) => boolean = (): boolean => true,
): Promise<readonly string[]> {
  let entries;

  try {
    entries = await fileSystem.readDirectory(directory);
  } catch {
    return [];
  }

  return entries
    .filter(([name, entry]) => entry.type === 'file' && isEligible(name))
    .map(([name]) => name);
}

export interface ReadDirectoryFilesOptions<T> {
  readonly isEligible?: (name: string) => boolean;
  // Reads one file; returning undefined leaves it out of the result.
  readonly read: (uri: StoryUri, name: string) => Promise<T | undefined>;
}

// Reads every eligible file in turn and skips the ones that fail to read or parse: one corrupt
// record must not hide the rest of the directory.
export async function readDirectoryFiles<T>(
  fileSystem: IFileSystem,
  directory: StoryUri,
  options: ReadDirectoryFilesOptions<T>,
): Promise<T[]> {
  const results: T[] = [];

  for (const name of await listDirectoryFileNames(fileSystem, directory, options.isEligible)) {
    try {
      const value = await options.read(joinStoryPath(directory, name), name);

      if (value !== undefined) {
        results.push(value);
      }
    } catch {
      continue;
    }
  }

  return results;
}

export async function loadTextFile(fileSystem: IFileSystem, uri: StoryUri): Promise<string> {
  return new TextDecoder().decode(await fileSystem.readFile(uri));
}

export async function saveTextFile(
  fileSystem: IFileSystem,
  uri: StoryUri,
  text: string,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(text));
}

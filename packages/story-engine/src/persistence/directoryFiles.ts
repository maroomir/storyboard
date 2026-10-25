import { joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';

export async function listDirectoryFileNames(
  fileSystem: IFileSystem,
  directory: StoryUri,
  isEligible: (name: string) => boolean = (): boolean => true,
): Promise<readonly string[]> {
  let entries: FileSystemDirectoryEntry[];

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
  readonly read: (uri: StoryUri, name: string) => Promise<T | undefined>;
}

export async function readDirectoryFiles<T>(
  fileSystem: IFileSystem,
  directory: StoryUri,
  options: ReadDirectoryFilesOptions<T>,
): Promise<T[]> {
  const parsedFiles: T[] = [];

  for (const name of await listDirectoryFileNames(fileSystem, directory, options.isEligible)) {
    try {
      const value: Awaited<T> | undefined = await options.read(
        joinStoryPath(directory, name),
        name,
      );

      if (value !== undefined) {
        parsedFiles.push(value);
      }
    } catch {
      continue;
    }
  }

  return parsedFiles;
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

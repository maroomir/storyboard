import {
  joinStoryPath,
  readSceneFile,
  scenePath,
} from '@storyboard/story-model';
import type {
  SceneFile,
  StoryUri,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';

export interface ReadDirectoryFilesOptions<T> {
  readonly isEligible?: (name: string) => boolean;
  readonly read: (uri: StoryUri, name: string) => Promise<T | undefined>;
}

const everyName = (): boolean => true;

export class WorkspaceFiles {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async listNames(
    directory: StoryUri,
    isEligible: (name: string) => boolean = everyName,
  ): Promise<readonly string[]> {
    let entries: FileSystemDirectoryEntry[];

    try {
      entries = await this.fileSystem.readDirectory(directory);
    } catch {
      return [];
    }

    return entries
      .filter(([name, entry]) => entry.type === 'file' && isEligible(name))
      .map(([name]) => name);
  }

  public async readAll<T>(
    directory: StoryUri,
    options: ReadDirectoryFilesOptions<T>,
  ): Promise<T[]> {
    const parsedFiles: T[] = [];

    for (const name of await this.listNames(directory, options.isEligible)) {
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

  public async loadText(uri: StoryUri): Promise<string> {
    return new TextDecoder().decode(await this.fileSystem.readFile(uri));
  }

  public async saveText(uri: StoryUri, text: string): Promise<void> {
    await this.fileSystem.writeFile(uri, new TextEncoder().encode(text));
  }

  public async readSceneOrUndefined(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<SceneFile | undefined> {
    try {
      return await readSceneFile(
        scenePath(workspaceRoot, sceneStem),
        this.fileSystem,
        `${sceneStem}.card`,
      );
    } catch {
      return undefined;
    }
  }
}

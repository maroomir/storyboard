import {
  getStoryboardProjectPaths,
  joinStoryPath,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';

export interface SceneStemMove {
  readonly fromStem: string;
  readonly toStem: string;
}

interface HeldCacheFile {
  readonly target: StoryUri;
  readonly content: string;
}

function stemKeyedDirectories(paths: StoryboardProjectPaths): readonly StoryUri[] {
  return [paths.sceneCacheDirectory, paths.revisionRoundsDirectory];
}

function cacheFileOf(directory: StoryUri, stem: string): StoryUri {
  return joinStoryPath(directory, `${stem}.json`);
}

function withSceneStem(raw: string, move: SceneStemMove): string {
  try {
    const record: unknown = JSON.parse(raw);
    const isRecordOfMovedStem: boolean =
      typeof record === 'object' &&
      record !== null &&
      (record as { readonly sceneStem?: unknown }).sceneStem === move.fromStem;

    return isRecordOfMovedStem
      ? `${JSON.stringify({ ...(record as object), sceneStem: move.toStem }, null, 2)}\n`
      : raw;
  } catch {
    return raw;
  }
}

export class StemKeyedSceneCaches {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async move(workspaceRoot: StoryUri, moves: readonly SceneStemMove[]): Promise<void> {
    for (const directory of stemKeyedDirectories(getStoryboardProjectPaths(workspaceRoot))) {
      const held: HeldCacheFile[] = await this.takeOut(directory, moves);
      for (const file of held) {
        await this.fileSystem.writeFile(file.target, new TextEncoder().encode(file.content));
      }
    }
  }

  public async remove(workspaceRoot: StoryUri, stem: string): Promise<void> {
    for (const directory of stemKeyedDirectories(getStoryboardProjectPaths(workspaceRoot))) {
      const file: StoryUri = cacheFileOf(directory, stem);
      if (await this.fileSystem.exists(file)) {
        await this.fileSystem.delete(file);
      }
    }
  }

  private async takeOut(
    directory: StoryUri,
    moves: readonly SceneStemMove[],
  ): Promise<HeldCacheFile[]> {
    const held: HeldCacheFile[] = [];
    for (const move of moves) {
      const source: StoryUri = cacheFileOf(directory, move.fromStem);
      if (!(await this.fileSystem.exists(source))) {
        continue;
      }

      const raw: string = new TextDecoder().decode(await this.fileSystem.readFile(source));
      held.push({ target: cacheFileOf(directory, move.toStem), content: withSceneStem(raw, move) });
      await this.fileSystem.delete(source);
    }

    return held;
  }
}

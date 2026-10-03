import type { StoryUri, StoryboardProject } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { INovelRunStateRepository } from '#engine/application/novel/novelPipeline';
import {
  getStoryboardProjectPaths,
  readNovelRunState,
  type NovelRunState,
  writeNovelRunState,
} from '@storyboard/story-model';
import { readProjectJson } from '#engine/persistence/projectJson';

export class NovelRunStateRepository implements INovelRunStateRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async readExisting(workspaceRoot: StoryUri): Promise<NovelRunState | undefined> {
    const { novelRunState } = getStoryboardProjectPaths(workspaceRoot);
    if (!(await this.fileSystem.exists(novelRunState))) {
      return undefined;
    }

    try {
      return await readNovelRunState(novelRunState, this.fileSystem);
    } catch {
      return undefined;
    }
  }

  public async loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject> {
    return await readProjectJson(
      this.fileSystem,
      getStoryboardProjectPaths(workspaceRoot).projectJson,
    );
  }

  public async save(workspaceRoot: StoryUri, state: NovelRunState): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.cacheDirectory);
    await writeNovelRunState(paths.novelRunState, this.fileSystem, state);
  }
}

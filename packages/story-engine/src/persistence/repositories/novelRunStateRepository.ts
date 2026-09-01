import type { StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { INovelRunStateRepository } from '#engine/application/novel/novelPipeline';
import { getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import {
  readNovelRunState,
  type NovelRunState,
  writeNovelRunState,
} from '#engine/domain/files/novelRunState';
import { readProjectJson } from '#engine/persistence/projectJson';
import type { StoryboardProject } from '@storyboard/story-format';

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

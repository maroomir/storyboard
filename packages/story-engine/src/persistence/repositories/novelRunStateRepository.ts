import { getStoryboardProjectPaths } from '@storyboard/story-model';
import type { NovelRunState, StoryboardProject, StoryUri } from '@storyboard/story-model';

import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import { RunStore } from '#engine/persistence/cache/runStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { INovelRunStateRepository } from '#engine/application/novel/novelPipeline';

export class NovelRunStateRepository implements INovelRunStateRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly caches: WorkspaceCaches,
  ) {}

  public async readExisting(workspaceRoot: StoryUri): Promise<NovelRunState | undefined> {
    try {
      return (await this.openStore(workspaceRoot)).findLatestNovelRun();
    } catch {
      return undefined;
    }
  }

  public async loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject> {
    return await new ProjectRepository(this.fileSystem).read(
      getStoryboardProjectPaths(workspaceRoot).projectJson,
    );
  }

  public async save(workspaceRoot: StoryUri, state: NovelRunState): Promise<void> {
    (await this.openStore(workspaceRoot)).saveNovelRun(state);
  }

  private async openStore(workspaceRoot: StoryUri): Promise<RunStore> {
    return new RunStore(await this.caches.open(workspaceRoot));
  }
}

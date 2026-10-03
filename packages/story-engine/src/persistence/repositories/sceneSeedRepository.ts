import { joinStoryPath, type StoryUri, getStoryboardProjectPaths } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneSeedRepository } from '#engine/application/novel/novelPipeline';
import type { GeneratedSceneSeed } from '@storyboard/story-model';

export class SceneSeedRepository implements ISceneSeedRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async saveSeeds(
    workspaceRoot: StoryUri,
    seeds: readonly GeneratedSceneSeed[],
  ): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.sceneDirectory);

    for (const seed of seeds) {
      await this.fileSystem.writeFile(
        joinStoryPath(paths.sceneDirectory, seed.fileName),
        new TextEncoder().encode(seed.content),
      );
    }
  }
}

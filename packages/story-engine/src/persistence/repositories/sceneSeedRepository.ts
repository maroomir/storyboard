import { joinStoryPath, type StoryUri } from '../../paths/storyUri';
import type { IFileSystem } from '../../ports/fileSystem';
import type { ISceneSeedRepository } from '../../application/novel/novelPipeline';
import { getStoryboardProjectPaths } from '../../paths/projectPaths';
import type { GeneratedSceneSeed } from '../../domain/sceneSeedFactory';

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

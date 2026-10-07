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

  public async saveMissingSeeds(
    workspaceRoot: StoryUri,
    seeds: readonly GeneratedSceneSeed[],
  ): Promise<number> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const missing: GeneratedSceneSeed[] = [];

    for (const seed of seeds) {
      if (!(await this.fileSystem.exists(joinStoryPath(paths.sceneDirectory, seed.fileName)))) {
        missing.push(seed);
      }
    }

    await this.saveSeeds(workspaceRoot, missing);
    return missing.length;
  }
}

import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
import {
  joinStoryPath,
  parseSceneFileName,
  type StoryUri,
  getStoryboardProjectPaths,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ISceneSeedRepository } from '#engine/application/novel/novelPipeline';
import type {
  GeneratedSceneSeed,
  SceneFileNameParts,
  StoryboardProjectPaths,
} from '@storyboard/story-model';

export class SceneSeedRepository implements ISceneSeedRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async saveSeeds(
    workspaceRoot: StoryUri,
    seeds: readonly GeneratedSceneSeed[],
  ): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.sceneDirectory);

    for (const seed of seeds) {
      await this.fileSystem.writeFile(
        joinStoryPath(paths.sceneDirectory, seed.fileName),
        new TextEncoder().encode(seed.content),
      );
    }
  }

  public async listSceneStemsByOrder(
    workspaceRoot: StoryUri,
  ): Promise<ReadonlyMap<number, string>> {
    const fileNames: readonly string[] = await new WorkspaceFiles(this.fileSystem).listNames(
      getStoryboardProjectPaths(workspaceRoot).sceneDirectory,
    );
    const stemsByOrder: Map<number, string> = new Map<number, string>();

    for (const fileName of [...fileNames].sort()) {
      const parts: SceneFileNameParts | undefined = parseSceneFileName(fileName);
      if (parts !== undefined && !stemsByOrder.has(parts.order)) {
        stemsByOrder.set(parts.order, parts.stem);
      }
    }

    return stemsByOrder;
  }

  public async saveMissingSeeds(
    workspaceRoot: StoryUri,
    seeds: readonly GeneratedSceneSeed[],
  ): Promise<number> {
    const stemsByOrder: ReadonlyMap<number, string> =
      await this.listSceneStemsByOrder(workspaceRoot);
    const missing: GeneratedSceneSeed[] = seeds.filter((seed) => {
      const order: number | undefined = parseSceneFileName(seed.fileName)?.order;
      return order === undefined || !stemsByOrder.has(order);
    });

    await this.saveSeeds(workspaceRoot, missing);
    return missing.length;
  }
}

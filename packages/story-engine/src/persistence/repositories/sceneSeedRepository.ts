import {
  parseSceneCard,
  parseSceneFileName,
  type GeneratedSceneSeed,
  type StatementSource,
  type StoryUri,
} from '@storyboard/story-model';
import type { ISceneSeedRepository } from '#engine/application/novel/novelPipeline';
import type { WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';

const seedSource: StatementSource = { origin: 'studio' };

export class SceneSeedRepository implements ISceneSeedRepository {
  public constructor(private readonly scenes: WorkspaceScenes) {}

  public async saveSeeds(
    workspaceRoot: StoryUri,
    seeds: readonly GeneratedSceneSeed[],
  ): Promise<void> {
    for (const seed of seeds) {
      const slug: string | undefined = parseSceneFileName(seed.fileName)?.slug;
      await this.scenes.writeCard(workspaceRoot, parseSceneCard(seed.content), {
        source: seedSource,
        ...(slug === undefined ? {} : { slug }),
      });
    }
  }

  public async listSceneStemsByOrder(
    workspaceRoot: StoryUri,
  ): Promise<ReadonlyMap<number, string>> {
    const { scenes } = await this.scenes.loadRoster(workspaceRoot);
    return new Map(scenes.map((scene) => [scene.order, scene.stem]));
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

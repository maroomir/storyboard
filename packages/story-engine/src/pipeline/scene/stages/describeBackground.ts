import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { assertNotCancelled } from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import type { BackgroundMemoryStore } from '#engine/pipeline/sceneGenerationTypes';
import type { Background, BackgroundCard } from '@storyboard/story-model';

export class DescribeBackgroundStage implements ISceneStage {
  public readonly id: SceneStageId = 'describeBackground';

  public async run(run: SceneGenerationRun): Promise<void> {
    if (run.context.background) {
      run.background = await this.describe(run, run.context.background);
    }
    assertNotCancelled(run.shouldCancel);
  }

  private async describe(run: SceneGenerationRun, card: BackgroundCard): Promise<Background> {
    const store: BackgroundMemoryStore | undefined = run.input.backgroundStore;
    const recentExcerpt: string | undefined = run.input.backgroundRecentExcerpt;
    const cached: string | undefined =
      recentExcerpt === undefined ? await store?.load(card) : undefined;
    let atmosphere: string | undefined = cached;
    if (atmosphere === undefined) {
      atmosphere = await run.aiService.describeBackground(
        card,
        { attribution: { primary: { kind: 'background', id: card.id } } },
        recentExcerpt,
      );

      if (recentExcerpt === undefined) {
        await store?.save(card, atmosphere);
      }
    }

    if (atmosphere.length === 0) {
      return card;
    }

    const description: string[] = [...(card.description ?? []), atmosphere];
    return { ...card, description };
  }
}

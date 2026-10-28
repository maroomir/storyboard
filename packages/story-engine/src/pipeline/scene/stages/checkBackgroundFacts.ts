import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { assertNotCancelled } from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import type { IBackgroundFactConflictStore } from '#engine/pipeline/memoryStore';
import {
  formatBackgroundFactConflict,
  listBackgroundFactLines,
  type BackgroundCard,
  type BackgroundFactConflict,
} from '@storyboard/story-model';

export class CheckBackgroundFactsStage implements ISceneStage {
  public readonly id: SceneStageId = 'checkBackgroundFacts';

  public async run(run: SceneGenerationRun): Promise<void> {
    const card: BackgroundCard | undefined = run.context.background;

    if (card) {
      run.backgroundFactConflicts = await this.findConflicts(run, card);
      run.warnings.push(
        ...run.backgroundFactConflicts.map(
          (conflict) =>
            `배경 «${card.name}»: ${formatBackgroundFactConflict(conflict)}는 함께 참일 수 없어 사건에 맞는 쪽만 씁니다.`,
        ),
      );
    }
    assertNotCancelled(run.shouldCancel);
  }

  private async findConflicts(
    run: SceneGenerationRun,
    card: BackgroundCard,
  ): Promise<readonly BackgroundFactConflict[]> {
    if (listBackgroundFactLines(card).length < 2) {
      return [];
    }

    const store: IBackgroundFactConflictStore | undefined = run.input.backgroundFactConflictStore;
    const cached: readonly BackgroundFactConflict[] | undefined = await store?.load(card);
    if (cached !== undefined) {
      return cached;
    }

    const conflicts: BackgroundFactConflict[] = await run.aiService.findBackgroundFactConflicts(
      card,
      { attribution: { primary: { kind: 'background', id: card.id } } },
    );
    await store?.save(card, conflicts);

    return conflicts;
  }
}

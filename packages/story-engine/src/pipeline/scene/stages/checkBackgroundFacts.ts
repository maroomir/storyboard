import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import {
  assertNotCancelled,
  findBackgroundFactConflictsForScene,
} from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import { formatBackgroundFactConflict, type BackgroundCard } from '@storyboard/story-model';

export class CheckBackgroundFactsStage implements ISceneStage {
  public readonly id: SceneStageId = 'checkBackgroundFacts';

  public async run(run: SceneGenerationRun): Promise<void> {
    const card: BackgroundCard | undefined = run.context.background;

    if (card) {
      run.backgroundFactConflicts = await findBackgroundFactConflictsForScene(
        card,
        run.aiService,
        run.input.backgroundFactConflictStore,
      );
      run.warnings.push(
        ...run.backgroundFactConflicts.map(
          (conflict) =>
            `배경 «${card.name}»: ${formatBackgroundFactConflict(conflict)}는 함께 참일 수 없어 사건에 맞는 쪽만 씁니다.`,
        ),
      );
    }
    assertNotCancelled(run.shouldCancel);
  }
}

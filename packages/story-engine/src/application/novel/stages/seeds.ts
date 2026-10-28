import { buildSceneSeeds } from '@storyboard/story-model';
import type { ChapterPlan, NovelStageName } from '@storyboard/story-model';
import type { INovelStage } from '#engine/application/novel/novelStage';
import type { NovelPipelineResult } from '#engine/application/novel/novelPipelineContract';
import type { NovelRun } from '#engine/application/novel/novelRun';

export class SeedsStage implements INovelStage {
  public readonly id: NovelStageName = 'seeds';

  public async run(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    const plan: ChapterPlan = await run.chapterPlan();

    await run.runStageOnce('seeds', '씬 시드 생성 중…', async () => {
      await run.services.repositories.sceneSeeds.saveMissingSeeds(
        run.options.workspaceUri,
        buildSceneSeeds(plan, run.scenePrefixDigitCount()),
      );
    });

    return await run.checkpoint();
  }
}

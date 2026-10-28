import type { NovelStageName } from '@storyboard/story-model';
import type { INovelStage } from '#engine/application/novel/novelStage';
import type { NovelPipelineResult } from '#engine/application/novel/novelPipelineContract';
import type { NovelRun } from '#engine/application/novel/novelRun';
import { VolumeReviewer, type ReviewStageResult } from './volumeReviewer';

export class ReviewStage implements INovelStage {
  public readonly id: NovelStageName = 'review';

  public async run(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    const reviewer: VolumeReviewer = new VolumeReviewer(run);

    if (run.completed.has('revise-from-review')) {
      await run.runStageOnce('review', '원고 최종 검사 중…', async () => {
        await reviewer.review();
      });
      return undefined;
    }

    run.options.onProgress('review', '원고 최종 검사 중…');
    const review: ReviewStageResult = await reviewer.review();
    run.completed.add('review');
    await run.persist({});
    run.review = review;

    if (review.targets.length === 0) {
      run.completed.add('revise-from-review');
      await run.persist({});
    }

    return undefined;
  }
}

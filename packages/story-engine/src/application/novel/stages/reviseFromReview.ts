import { draftPath, integerSettingDefault } from '@storyboard/story-model';
import type { NovelStageName } from '@storyboard/story-model';
import type { ReviseDraftWorkflowResult } from '#engine/application/drafts/reviseDraftUseCase';
import type { INovelStage } from '#engine/application/novel/novelStage';
import type { NovelPipelineResult } from '#engine/application/novel/novelPipelineContract';
import type { NovelRun } from '#engine/application/novel/novelRun';
import { RevisionPlanRecorder } from '#engine/persistence/revisionPlanRecorder';
import type {
  ReviewStageResult,
  ReviewTarget,
} from '#engine/application/novel/novelPipelineContract';
import { VolumeReviewer } from './volumeReviewer';

export class ReviseFromReviewStage implements INovelStage {
  public readonly id: NovelStageName = 'revise-from-review';

  public async run(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    const { options } = run;

    if (run.completed.has('revise-from-review')) {
      return undefined;
    }

    const reviewer: VolumeReviewer = new VolumeReviewer(run);
    const review: ReviewStageResult = run.review ?? (await reviewer.review());
    const { targets } = review;

    if (targets.length === 0) {
      run.completed.add('revise-from-review');
      await run.persist({});
      return undefined;
    }

    if (options.runMode === 'review-approval') {
      const stems: string = targets.map((target) => target.sceneStem).join(', ');
      const paused: NovelPipelineResult | undefined = await run.pauseForApproval({
        kind: 'review',
        info: `최종 검사에서 high 이슈 ${review.highCount}건을 찾았습니다. 다음 씬을 재작성할까요? ${stems}`,
        pausedMessage: '최종 검사 승인 대기에서 멈췄습니다.',
      });
      if (paused) {
        return paused;
      }
    }

    options.onProgress('revise-from-review', '검수 결과로 재작성 중…');
    const revisedStems: string[] = await this.reviseTargets(run, targets);
    run.completed.add('revise-from-review');
    await run.persist({});

    if (options.shouldCancel()) {
      return await run.cancel();
    }

    options.onProgress('review', '재작성분 재검사 중…');
    await reviewer.review(revisedStems);

    return undefined;
  }

  private async reviseTargets(run: NovelRun, targets: readonly ReviewTarget[]): Promise<string[]> {
    const { options, paths } = run;
    const revisedStems: string[] = [];

    for (const target of targets) {
      if (options.shouldCancel()) {
        return revisedStems;
      }

      options.onProgress('revise-from-review', `«${target.sceneStem}» 재작성 중…`);

      const reviseResult: ReviseDraftWorkflowResult =
        await run.services.collaborators.reviseDraftUseCase.execute({
          workspaceUri: options.workspaceUri,
          paths,
          draftUri: draftPath(options.workspaceUri, target.sceneStem),
          sceneStem: target.sceneStem,
          maxIterations: 1,
          maxCompressionPercent:
            run.services.host.configBridge.getMaxCompressionPercent?.() ??
            integerSettingDefault('revise.length.maxCompressionPercent'),
          reviseScoreThreshold: 0,
          seedIssues: target.seedIssues,
          shouldCancel: options.shouldCancel,
        });

      if (reviseResult.revisionCount > 0) {
        revisedStems.push(target.sceneStem);
      }

      await new RevisionPlanRecorder(run.services.host.fileSystem).recordEntry(paths, {
        sceneStem: target.sceneStem,
        checkedAt: new Date().toISOString(),
        revisionCount: reviseResult.revisionCount,
        remainingBlocking: reviseResult.remainingBlocking,
        instructions: reviseResult.instructions,
        preservedOriginal: reviseResult.preservedOriginal,
        rejection: reviseResult.rejection,
      });
    }

    return revisedStems;
  }
}

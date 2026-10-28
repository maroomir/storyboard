import type { NovelStageName } from '@storyboard/story-model';
import type { SummarizeChaptersResult } from '#engine/application/manuscript/summarizeChaptersUseCase';
import type { INovelStage } from '#engine/application/novel/novelStage';
import type { NovelPipelineResult } from '#engine/application/novel/novelPipelineContract';
import type { NovelRun } from '#engine/application/novel/novelRun';

export class SummariesStage implements INovelStage {
  public readonly id: NovelStageName = 'summaries';

  public async run(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    await run.runStageOnce('summaries', '장별 요약 중…', () => this.summarize(run));
    return undefined;
  }

  private async summarize(run: NovelRun): Promise<void> {
    const summaryResult: SummarizeChaptersResult =
      await run.services.collaborators.summarizeChaptersUseCase.execute({
        workspaceRoot: run.options.workspaceUri,
      });
    if (!summaryResult.ok) {
      throw new Error(
        summaryResult.kind === 'failed'
          ? summaryResult.message
          : `장별 요약을 완료할 수 없습니다: ${summaryResult.kind}`,
      );
    }
  }
}

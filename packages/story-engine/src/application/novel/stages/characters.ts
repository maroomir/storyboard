import type { ChapterPlan, NovelStageName } from '@storyboard/story-model';
import type { INovelStage } from '#engine/application/novel/novelStage';
import type { NovelPipelineResult } from '#engine/application/novel/novelPipelineContract';
import type { NovelRun } from '#engine/application/novel/novelRun';
import {
  PlanCastCardWriter,
  type PlanCastCardReport,
} from '#engine/application/novel/planCastCardWriter';

export class CharactersStage implements INovelStage {
  public readonly id: NovelStageName = 'characters';

  public async run(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    const { options } = run;
    const plan: ChapterPlan = await run.chapterPlan();

    await run.runStageOnce('characters', '인물 카드 확인 중…', async () => {
      const report: PlanCastCardReport = await this.writeMissingCards(run, plan);

      if (report.writtenCount > 0) {
        options.onProgress('characters', `인물 카드 ${report.writtenCount}장을 만들었습니다.`);
      }
      if (report.missingIds.length > 0) {
        options.onProgress(
          'characters',
          `모델이 카드를 돌려주지 않은 인물이 있습니다: ${report.missingIds.join(', ')}. 카드를 직접 만들어 주세요.`,
        );
      }
      if (report.unusableIds.length > 0) {
        options.onProgress(
          'characters',
          `카드 이름이 될 수 없는 인물 id 라 카드를 만들지 않았습니다: ${report.unusableIds.join(', ')}. outline/chapters.yaml 의 id 를 영소문자로 고쳐 주세요.`,
        );
      }
    });

    return await run.checkpoint();
  }

  private async writeMissingCards(run: NovelRun, plan: ChapterPlan): Promise<PlanCastCardReport> {
    return await new PlanCastCardWriter({
      novelOutline: run.services.repositories.novelOutline,
      cardWriter: run.services.repositories.cardWriter,
    }).writeMissingCards({
      workspaceRoot: run.options.workspaceUri,
      project: run.options.project,
      plan,
      aiService: run.newAiService(),
    });
  }
}

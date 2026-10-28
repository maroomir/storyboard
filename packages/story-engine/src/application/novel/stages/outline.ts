import { flattenChapterPlan, toOutlineBrief } from '@storyboard/story-model';
import type {
  ChapterPlan,
  NovelStageName,
  OutlineBrief,
  OutlineCharacterBrief,
  OutlineSynopsis,
} from '@storyboard/story-model';
import { refuseChapterCountMismatch } from '#engine/application/novel/chapterPlanContract';
import type { INovelStage } from '#engine/application/novel/novelStage';
import type {
  NovelAiService,
  NovelPipelineResult,
} from '#engine/application/novel/novelPipelineContract';
import type { INovelOutlineRepository } from '#engine/application/novel/novelPipelinePorts';
import type { NovelRun } from '#engine/application/novel/novelRun';

export class OutlineStage implements INovelStage {
  public readonly id: NovelStageName = 'outline';

  public async run(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    const { options } = run;
    const wasCompleted: boolean = run.completed.has('outline');

    await run.runStageOnce('outline', '아웃라인 생성 중…', () => this.generate(run));

    if (!wasCompleted && options.runMode !== 'auto') {
      const paused: NovelPipelineResult | undefined = await run.pauseForApproval({
        kind: 'outline',
        info: '아웃라인(synopsis.md, chapters.yaml)을 검토하세요. 계속할까요?',
        pausedMessage: '아웃라인 승인 대기에서 멈췄습니다.',
      });
      if (paused) {
        return paused;
      }
    }

    return await run.checkpoint();
  }

  private async generate(run: NovelRun): Promise<void> {
    const { workspaceUri, project } = run.options;
    const aiService: NovelAiService = run.newAiService();
    const outlineRepository: INovelOutlineRepository = run.services.repositories.novelOutline;
    const brief: OutlineBrief = toOutlineBrief(project);
    const keptPlan: ChapterPlan | undefined = (await outlineRepository.hasChapterPlan(workspaceUri))
      ? await outlineRepository.loadChapterPlan(workspaceUri)
      : undefined;

    if (keptPlan !== undefined && flattenChapterPlan(keptPlan).length > 0) {
      refuseChapterCountMismatch(brief, keptPlan, 'kept');

      if ((await outlineRepository.loadSynopsis(workspaceUri)) === undefined) {
        await outlineRepository.saveSynopsis(
          workspaceUri,
          await aiService.generateOutlineSynopsis(brief),
        );
      }
      return;
    }

    const synopsis: OutlineSynopsis = await aiService.generateOutlineSynopsis(brief);
    const characters: readonly OutlineCharacterBrief[] =
      await outlineRepository.loadCharacterBriefs(workspaceUri);
    const chapterPlan: ChapterPlan = await aiService.generateChapterPlan(
      brief,
      synopsis,
      characters,
    );
    refuseChapterCountMismatch(brief, chapterPlan, 'generated');

    await outlineRepository.save(workspaceUri, synopsis, chapterPlan);
  }
}

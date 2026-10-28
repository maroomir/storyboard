import { draftPath, integerSettingDefault, scenePath } from '@storyboard/story-model';
import type { NovelStageName, StoryUri } from '@storyboard/story-model';
import type { GenerateDraftResult } from '#engine/application/drafts/draftGenerationContract';
import type { ReviseDraftWorkflowResult } from '#engine/application/drafts/reviseDraftUseCase';
import type { SummarizeChaptersResult } from '#engine/application/manuscript/summarizeChaptersUseCase';
import type { ChapterGroup } from '#engine/application/novel/chapterGrouping';
import type { INovelStage } from '#engine/application/novel/novelStage';
import type { NovelPipelineResult } from '#engine/application/novel/novelPipelineContract';
import type { NovelRun } from '#engine/application/novel/novelRun';
import { RevisionPlanRecorder } from '#engine/persistence/revisionPlanRecorder';

type ChapterDraftsOutcome = 'finished' | 'paused' | { readonly limitReached: string };

export class ChaptersStage implements INovelStage {
  public readonly id: NovelStageName = 'chapters';

  public async run(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    const chapterResult: NovelPipelineResult | undefined = await this.draftChapters(run);
    if (chapterResult) {
      return chapterResult;
    }

    return await run.checkpoint();
  }

  private async draftChapters(run: NovelRun): Promise<NovelPipelineResult | undefined> {
    const { options, state, completed } = run;
    if (completed.has('chapters')) {
      return undefined;
    }

    const groups: readonly ChapterGroup[] = await run.chapterGroups();

    for (
      let chapterIndex: number = state.nextChapterIndex;
      chapterIndex < groups.length;
      chapterIndex += 1
    ) {
      const group: ChapterGroup | undefined = groups[chapterIndex];
      if (!group) {
        continue;
      }
      options.onProgress(
        'chapters',
        `${chapterIndex + 1}/${groups.length}장 «${group.title}» 초안·검수 중…`,
      );

      const draftsOutcome: ChapterDraftsOutcome = await this.draftAndRevise(run, group);
      if (draftsOutcome === 'paused') {
        return await run.pause();
      }
      if (draftsOutcome !== 'finished') {
        return await run.pause(draftsOutcome.limitReached);
      }

      await this.refreshChapterSummary(run, chapterIndex);

      await run.persist({ nextChapterIndex: chapterIndex + 1 });

      if (options.shouldCancel()) {
        return await run.cancel();
      }

      const pausedAfterChapter: NovelPipelineResult | undefined = await run.pauseIfRequested();
      if (pausedAfterChapter) {
        return pausedAfterChapter;
      }

      const isLastChapter: boolean = chapterIndex === groups.length - 1;
      if (options.runMode === 'chapter-approval' && !isLastChapter) {
        const paused: NovelPipelineResult | undefined = await run.pauseForApproval({
          kind: 'chapter',
          info: `${chapterIndex + 1}장을 마쳤습니다. 다음 장으로 진행할까요?`,
          pausedMessage: `${chapterIndex + 1}장까지 진행하고 멈췄습니다.`,
        });
        if (paused) {
          return paused;
        }
      }
    }

    completed.add('chapters');
    await run.persist({});
    return undefined;
  }

  private async draftAndRevise(run: NovelRun, group: ChapterGroup): Promise<ChapterDraftsOutcome> {
    const { options, paths } = run;

    for (const stem of group.stems) {
      if (options.shouldCancel()) {
        return 'finished';
      }

      if (options.shouldPause?.()) {
        return 'paused';
      }

      const sceneUri: StoryUri = scenePath(options.workspaceUri, stem);
      const draftResult: GenerateDraftResult =
        await run.services.collaborators.generateDraftUseCase.execute({
          sceneUri,
          force: false,
          suppressLoggerPanel: true,
          shouldCancel: options.shouldCancel,
        });

      if (!draftResult.ok) {
        if (draftResult.kind === 'cancelled') {
          return 'finished';
        }
        if (draftResult.reason === 'usage-limit') {
          return { limitReached: draftResult.message };
        }
        throw new Error(`초안 생성 실패(${stem}): ${draftResult.message}`);
      }

      const reviseResult: ReviseDraftWorkflowResult =
        await run.services.collaborators.reviseDraftUseCase.execute({
          workspaceUri: options.workspaceUri,
          paths,
          draftUri: draftPath(options.workspaceUri, stem),
          sceneStem: stem,
          maxIterations: options.reviseMaxIterations,
          maxCompressionPercent:
            run.services.host.configBridge.getMaxCompressionPercent?.() ??
            integerSettingDefault('revise.length.maxCompressionPercent'),
          reviseScoreThreshold: 0,
          shouldCancel: options.shouldCancel,
        });

      await new RevisionPlanRecorder(run.services.host.fileSystem).recordEntry(paths, {
        sceneStem: stem,
        checkedAt: new Date().toISOString(),
        revisionCount: reviseResult.revisionCount,
        remainingBlocking: reviseResult.remainingBlocking,
        instructions: reviseResult.instructions,
        preservedOriginal: reviseResult.preservedOriginal,
        rejection: reviseResult.rejection,
      });
    }

    return 'finished';
  }

  private async refreshChapterSummary(run: NovelRun, chapterIndex: number): Promise<void> {
    const summaryResult: SummarizeChaptersResult =
      await run.services.collaborators.summarizeChaptersUseCase.execute({
        workspaceRoot: run.options.workspaceUri,
        chapterIndex,
      });

    if (!summaryResult.ok) {
      run.options.onProgress(
        'chapters',
        `${chapterIndex + 1}장 요약을 갱신하지 못했습니다. 다음 장은 이전 요약으로 진행합니다.`,
      );
    }
  }
}

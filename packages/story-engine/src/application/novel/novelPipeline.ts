import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import { extractErrorMessage } from '@storyboard/story-model';
import type { NovelStageName } from '@storyboard/story-model';
import { NovelRun } from '#engine/application/novel/novelRun';
import type { INovelStage } from '#engine/application/novel/novelStage';
import { resolveNovelPipelinePlan } from '#engine/application/novel/novelStageCatalog';
import type {
  NovelPipelineCollaborators,
  NovelPipelineOptions,
  NovelPipelineResult,
  NovelPipelineRunOptions,
} from '#engine/application/novel/novelPipelineContract';
import { AssembleStage } from '#engine/application/novel/stages/assemble';
import { ChaptersStage } from '#engine/application/novel/stages/chapters';
import { CharactersStage } from '#engine/application/novel/stages/characters';
import { OutlineStage } from '#engine/application/novel/stages/outline';
import { ReviewStage } from '#engine/application/novel/stages/review';
import { ReviseFromReviewStage } from '#engine/application/novel/stages/reviseFromReview';
import { SeedsStage } from '#engine/application/novel/stages/seeds';
import { SummariesStage } from '#engine/application/novel/stages/summaries';

export type {
  INovelOutlineRepository,
  INovelReviewRepository,
  INovelRunStateRepository,
  ISceneSeedRepository,
  NovelReviewSource,
} from '#engine/application/novel/novelPipelinePorts';
export type {
  NovelApprovalKind,
  NovelPipelineOptions,
  NovelPipelineOutcome,
  NovelPipelineResult,
  NovelPipelineRunOptions,
} from '#engine/application/novel/novelPipelineContract';

export const novelStages: Readonly<Record<NovelStageName, INovelStage>> = {
  outline: new OutlineStage(),
  characters: new CharactersStage(),
  seeds: new SeedsStage(),
  chapters: new ChaptersStage(),
  assemble: new AssembleStage(),
  review: new ReviewStage(),
  'revise-from-review': new ReviseFromReviewStage(),
  summaries: new SummariesStage(),
};

export class NovelPipeline {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
    private readonly collaborators: NovelPipelineCollaborators,
  ) {}

  public async run(options: NovelPipelineRunOptions): Promise<NovelPipelineResult> {
    const runOptions: NovelPipelineOptions = {
      ...options,
      deps: {
        host: this.host,
        ai: this.ai,
        repositories: this.repositories,
        collaborators: this.collaborators,
      },
    };
    const run: NovelRun = new NovelRun(runOptions);

    try {
      await run.persist({ status: 'running' });

      for (const id of options.stages ?? resolveNovelPipelinePlan()) {
        const stop: NovelPipelineResult | undefined = await novelStages[id].run(run);
        if (stop) {
          return stop;
        }
      }

      await run.persist({ status: 'done' });
      return { outcome: 'completed', message: '장편 생성을 완료했습니다.' };
    } catch (error) {
      this.host.logger.error('Novel pipeline failed', error);
      const message: string = extractErrorMessage(error);
      await run.persist({ status: 'failed', lastError: message }).catch(() => undefined);
      return { outcome: 'failed', message };
    }
  }
}

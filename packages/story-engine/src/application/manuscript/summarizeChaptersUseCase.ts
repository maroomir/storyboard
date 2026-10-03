import type { StoryUri } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import type { AiGateway } from '#engine/application/ai/aiGateway';
import {
  auditChapterSummaries,
  buildChapterSummariesMarkdown,
  mergeChapterSummary,
  parseChapterSummariesMarkdown,
  type ChapterSummary,
  assembleManuscript,
  computeDraftBodyHash,
} from '@storyboard/story-model';
import type { ManuscriptAssemblySource } from './assembleManuscriptUseCase';

export interface IChapterSummaryRepository {
  hasChapterPlan(workspaceRoot: StoryUri): Promise<boolean>;
  loadAssemblySource(workspaceRoot: StoryUri): Promise<ManuscriptAssemblySource>;
  readChapterSummaries(workspaceRoot: StoryUri): Promise<string | undefined>;
  saveChapterSummaries(workspaceRoot: StoryUri, markdown: string): Promise<StoryUri>;
}

export type SummarizeChaptersOptions = {
  // Summarize only this chapter (0-based) and merge it into the existing file. The novel pipeline
  // passes it after each chapter so a later chapter generates against the story so far; omitting it
  // resummarizes the whole manuscript.
  readonly chapterIndex?: number;
  readonly onProgress?: (current: number, total: number) => void;
  readonly shouldCancel?: () => boolean;
};

export type SummarizeChaptersResult =
  | { readonly kind: 'cancelled'; readonly ok: false }
  | { readonly kind: 'missing_drafts'; readonly ok: false }
  | { readonly kind: 'missing_outline'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false }
  | {
      readonly kind: 'summarized';
      readonly ok: true;
      readonly summaryCount: number;
      readonly summaryUri: StoryUri;
    };

export interface SummarizeChaptersUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly repository: IChapterSummaryRepository;
  readonly logger: IStoryboardLogger;
}

export type SummarizeChaptersRequest = SummarizeChaptersOptions & {
  readonly workspaceRoot: StoryUri;
};

export class SummarizeChaptersUseCase implements IUseCase<
  SummarizeChaptersRequest,
  SummarizeChaptersResult
> {
  public constructor(private readonly deps: SummarizeChaptersUseCaseDependencies) {}

  public async execute(request: SummarizeChaptersRequest): Promise<SummarizeChaptersResult> {
    const { workspaceRoot, ...options } = request;

    return await runUseCase<SummarizeChaptersResult>(
      this.deps.logger,
      'Summarize chapters failed',
      async () => {
        if (!(await this.deps.repository.hasChapterPlan(workspaceRoot))) {
          return { kind: 'missing_outline', ok: false };
        }

        const source = await this.deps.repository.loadAssemblySource(workspaceRoot);
        if (source.draftsByOrder.size === 0) {
          return { kind: 'missing_drafts', ok: false };
        }

        const manuscript = assembleManuscript({
          draftsByOrder: source.draftsByOrder,
          plan: source.plan,
          projectName: source.projectName,
        });
        const targeted =
          options.chapterIndex === undefined
            ? manuscript.chapters
            : manuscript.chapters.slice(options.chapterIndex, options.chapterIndex + 1);

        if (targeted.length === 0) {
          return { kind: 'missing_drafts', ok: false };
        }

        const aiService = this.deps.aiGateway.createService(workspaceRoot);
        const providerId = this.deps.aiGateway.getTaskProvider('chapterSummary');
        const sourceHashes = new Map(
          manuscript.chapters.map((chapter) => [
            chapter.chapterTitle,
            computeDraftBodyHash(chapter.markdown),
          ]),
        );
        // 한 장만 다시 요약할 때도 나머지 장의 낡음 표시를 다시 매긴다. 이 실행이 요약 파일을
        // 어차피 쓰므로, 표시가 실제와 어긋난 채로 남는 창이 생기지 않는다.
        let summaries: readonly ChapterSummary[] =
          options.chapterIndex === undefined
            ? []
            : auditChapterSummaries(await this.readExisting(workspaceRoot), sourceHashes).summaries;

        for (const [index, chapter] of targeted.entries()) {
          if (options.shouldCancel?.()) {
            return { kind: 'cancelled', ok: false };
          }

          options.onProgress?.(index + 1, targeted.length);
          const summary = await aiService.summarizeChapter(
            { body: chapter.markdown, chapterTitle: chapter.chapterTitle },
            { providerId },
          );
          summaries = mergeChapterSummary(summaries, {
            chapterTitle: chapter.chapterTitle,
            summary,
            sourceHash: computeDraftBodyHash(chapter.markdown),
            isStale: false,
          });
        }

        const summaryUri = await this.deps.repository.saveChapterSummaries(
          workspaceRoot,
          buildChapterSummariesMarkdown(source.projectName, summaries),
        );

        return { kind: 'summarized', ok: true, summaryCount: summaries.length, summaryUri };
      },
    );
  }

  private async readExisting(workspaceRoot: StoryUri): Promise<ChapterSummary[]> {
    const markdown = await this.deps.repository.readChapterSummaries(workspaceRoot);
    return markdown === undefined ? [] : parseChapterSummariesMarkdown(markdown);
  }
}

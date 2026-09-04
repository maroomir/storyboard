import type { StoryUri } from '@storyboard/story-format';
import type { AiGateway } from '#engine/application/ai/aiGateway';
import {
  buildChapterSummariesMarkdown,
  mergeChapterSummary,
  parseChapterSummariesMarkdown,
  type ChapterSummary,
} from '#engine/domain/chapterSummaries';
import { assembleManuscript } from '@storyboard/story-format';
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

export class SummarizeChaptersUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly repository: IChapterSummaryRepository,
  ) {}

  public async execute(
    workspaceRoot: StoryUri,
    options: SummarizeChaptersOptions = {},
  ): Promise<SummarizeChaptersResult> {
    try {
      if (!(await this.repository.hasChapterPlan(workspaceRoot))) {
        return { kind: 'missing_outline', ok: false };
      }

      const source = await this.repository.loadAssemblySource(workspaceRoot);
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

      const aiService = this.aiGateway.createService(workspaceRoot);
      const providerId = this.aiGateway.getTaskProvider('chapterSummary');
      let summaries =
        options.chapterIndex === undefined ? [] : await this.readExisting(workspaceRoot);

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
        });
      }

      const summaryUri = await this.repository.saveChapterSummaries(
        workspaceRoot,
        buildChapterSummariesMarkdown(source.projectName, summaries),
      );

      return { kind: 'summarized', ok: true, summaryCount: summaries.length, summaryUri };
    } catch (error) {
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }

  private async readExisting(workspaceRoot: StoryUri): Promise<ChapterSummary[]> {
    const markdown = await this.repository.readChapterSummaries(workspaceRoot);
    return markdown === undefined ? [] : parseChapterSummariesMarkdown(markdown);
  }
}

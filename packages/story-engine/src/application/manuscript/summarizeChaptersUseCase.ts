import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type {
  AiProviderId,
  AssembledChapter,
  AssembledManuscript,
  StoryUri,
} from '@storyboard/story-model';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import {
  auditChapterSummaries,
  buildChapterSummariesMarkdown,
  mergeChapterSummary,
  parseChapterSummariesMarkdown,
  type ChapterSummary,
  assembleManuscript,
  computeDraftBodyHash,
} from '@storyboard/story-model';
import type { StoryboardAiService } from '@storyboard/story-ai';
import type { ManuscriptAssemblySource } from '#engine/application/manuscript/manuscriptRepositories';

export type SummarizeChaptersOptions = {
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

export type SummarizeChaptersRequest = SummarizeChaptersOptions & {
  readonly workspaceRoot: StoryUri;
};

export class SummarizeChaptersUseCase implements IUseCase<
  SummarizeChaptersRequest,
  SummarizeChaptersResult
> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: SummarizeChaptersRequest): Promise<SummarizeChaptersResult> {
    const { workspaceRoot, ...options } = request;

    return await runUseCase<SummarizeChaptersResult>(
      this.host.logger,
      'Summarize chapters failed',
      async () => await this.summarizeChapters(workspaceRoot, options),
    );
  }

  private async summarizeChapters(
    workspaceRoot: StoryUri,
    options: SummarizeChaptersOptions,
  ): Promise<SummarizeChaptersResult> {
    if (!(await this.repositories.chapterSummaries.hasChapterPlan(workspaceRoot))) {
      return { kind: 'missing_outline', ok: false };
    }

    const source: ManuscriptAssemblySource =
      await this.repositories.chapterSummaries.loadAssemblySource(workspaceRoot);
    if (source.draftsByOrder.size === 0) {
      return { kind: 'missing_drafts', ok: false };
    }

    const manuscript: AssembledManuscript = assembleManuscript({
      draftsByOrder: source.draftsByOrder,
      plan: source.plan,
      projectName: source.projectName,
    });
    const targeted: AssembledChapter[] =
      options.chapterIndex === undefined
        ? manuscript.chapters
        : manuscript.chapters.slice(options.chapterIndex, options.chapterIndex + 1);

    if (targeted.length === 0) {
      return { kind: 'missing_drafts', ok: false };
    }

    const summaries: readonly ChapterSummary[] | undefined = await this.summarizeTargetedChapters(
      workspaceRoot,
      manuscript,
      targeted,
      options,
    );
    if (summaries === undefined) {
      return { kind: 'cancelled', ok: false };
    }

    const summaryUri: StoryUri = await this.repositories.chapterSummaries.saveChapterSummaries(
      workspaceRoot,
      buildChapterSummariesMarkdown(source.projectName, summaries),
    );

    return { kind: 'summarized', ok: true, summaryCount: summaries.length, summaryUri };
  }

  private async summarizeTargetedChapters(
    workspaceRoot: StoryUri,
    manuscript: AssembledManuscript,
    targeted: readonly AssembledChapter[],
    options: SummarizeChaptersOptions,
  ): Promise<readonly ChapterSummary[] | undefined> {
    const aiService: StoryboardAiService = this.ai.gateway.createService(workspaceRoot);
    const providerId: AiProviderId = this.ai.gateway.getTaskProvider('chapterSummary');
    let summaries: readonly ChapterSummary[] = await this.loadKeptSummaries(
      workspaceRoot,
      manuscript,
      options.chapterIndex,
    );

    for (const [index, chapter] of targeted.entries()) {
      if (options.shouldCancel?.()) {
        return undefined;
      }

      options.onProgress?.(index + 1, targeted.length);
      const summary: string = await aiService.summarizeChapter(
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

    return summaries;
  }

  private async loadKeptSummaries(
    workspaceRoot: StoryUri,
    manuscript: AssembledManuscript,
    chapterIndex: number | undefined,
  ): Promise<readonly ChapterSummary[]> {
    if (chapterIndex === undefined) {
      return [];
    }

    const sourceHashes: Map<string, string> = new Map(
      manuscript.chapters.map((chapter) => [
        chapter.chapterTitle,
        computeDraftBodyHash(chapter.markdown),
      ]),
    );
    return auditChapterSummaries(await this.readExisting(workspaceRoot), sourceHashes).summaries;
  }

  private async readExisting(workspaceRoot: StoryUri): Promise<ChapterSummary[]> {
    const markdown: string | undefined =
      await this.repositories.chapterSummaries.readChapterSummaries(workspaceRoot);
    return markdown === undefined ? [] : parseChapterSummariesMarkdown(markdown);
  }
}

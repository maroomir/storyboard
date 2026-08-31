import type * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import { buildChapterSummariesMarkdown, type ChapterSummary } from '@storyboard/story-engine';
import { assembleManuscript } from '@storyboard/story-format';
import type { ManuscriptAssemblySource } from './assembleManuscriptUseCase';

export interface IChapterSummaryRepository {
  hasChapterPlan(workspaceRoot: vscode.Uri): Promise<boolean>;
  loadAssemblySource(workspaceRoot: vscode.Uri): Promise<ManuscriptAssemblySource>;
  saveChapterSummaries(workspaceRoot: vscode.Uri, markdown: string): Promise<vscode.Uri>;
}

export type SummarizeChaptersOptions = {
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
      readonly summaryUri: vscode.Uri;
    };

export class SummarizeChaptersUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly repository: IChapterSummaryRepository,
  ) {}

  public async execute(
    workspaceRoot: vscode.Uri,
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
      const aiService = this.aiGateway.createService(workspaceRoot);
      const providerId = this.aiGateway.getTaskProvider('chapterSummary');
      const summaries: ChapterSummary[] = [];

      for (const [index, chapter] of manuscript.chapters.entries()) {
        if (options.shouldCancel?.()) {
          return { kind: 'cancelled', ok: false };
        }

        options.onProgress?.(index + 1, manuscript.chapters.length);
        const summary = await aiService.summarizeChapter(
          { body: chapter.markdown, chapterTitle: chapter.chapterTitle },
          { providerId },
        );
        summaries.push({ chapterTitle: chapter.chapterTitle, summary });
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
}

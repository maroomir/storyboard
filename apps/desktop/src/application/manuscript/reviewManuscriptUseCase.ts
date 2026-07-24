import type * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { assembleManuscript } from '../../domain/manuscriptAssembly';
import { buildManuscriptReviewMarkdown } from '../../domain/manuscriptReview';
import { flattenChapterPlan } from '@storyboard/story-format';
import type { ChapterPlan } from '@storyboard/story-format';
import type { ManuscriptAssemblySource } from './assembleManuscriptUseCase';

export type ManuscriptReviewSource = {
  readonly source: ManuscriptAssemblySource;
  readonly styleConstraints: readonly string[];
  readonly qualityCriteria: readonly string[];
  readonly canonFactLines: readonly string[];
};

export interface IManuscriptReviewRepository {
  hasChapterPlan(workspaceRoot: vscode.Uri): Promise<boolean>;
  loadReviewSource(
    workspaceRoot: vscode.Uri,
    logger: Pick<StoryboardLogger, 'warn'>,
  ): Promise<ManuscriptReviewSource>;
  saveReview(workspaceRoot: vscode.Uri, markdown: string): Promise<vscode.Uri>;
}

export type ReviewManuscriptResult =
  | { readonly kind: 'missing_drafts'; readonly ok: false }
  | { readonly kind: 'missing_outline'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false }
  | {
      readonly kind: 'reviewed';
      readonly ok: true;
      readonly continuityCount: number;
      readonly critiqueCount: number;
      readonly reportUri: vscode.Uri;
    };

export class ReviewManuscriptUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly repository: IManuscriptReviewRepository,
    private readonly logger: StoryboardLogger,
  ) {}

  public async execute(workspaceRoot: vscode.Uri): Promise<ReviewManuscriptResult> {
    try {
      if (!(await this.repository.hasChapterPlan(workspaceRoot))) {
        return { kind: 'missing_outline', ok: false };
      }

      const { source, styleConstraints, qualityCriteria, canonFactLines } =
        await this.repository.loadReviewSource(workspaceRoot, this.logger);
      if (source.draftsByOrder.size === 0) {
        return { kind: 'missing_drafts', ok: false };
      }

      const manuscript = assembleManuscript({
        draftsByOrder: source.draftsByOrder,
        plan: source.plan,
        projectName: source.projectName,
      });
      const characters = collectCharacterIds(source.plan);
      const aiService = this.aiGateway.createService(workspaceRoot);

      const [continuityIssues, critiqueIssues] = await Promise.all([
        aiService.checkContinuity(manuscript.volumeMarkdown, canonFactLines, {
          providerId: this.aiGateway.getTaskProvider('continuityCheck'),
        }),
        aiService.critiqueDraft(
          {
            body: manuscript.volumeMarkdown,
            intent: '전체 원고 최종 검수',
            characters,
            facts: canonFactLines,
            styleConstraints,
            qualityCriteria,
          },
          { providerId: this.aiGateway.getTaskProvider('draftCritique') },
        ),
      ]);

      const reportMarkdown = buildManuscriptReviewMarkdown({
        projectName: source.projectName,
        sceneCount: manuscript.includedCount,
        generatedAt: new Date().toISOString(),
        continuityIssues,
        critiqueIssues,
      });
      const reportUri = await this.repository.saveReview(workspaceRoot, reportMarkdown);

      return {
        kind: 'reviewed',
        ok: true,
        continuityCount: continuityIssues.length,
        critiqueCount: critiqueIssues.length,
        reportUri,
      };
    } catch (error) {
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }
}

function collectCharacterIds(plan: ChapterPlan): string[] {
  const ids = new Set<string>();

  for (const flatScene of flattenChapterPlan(plan)) {
    for (const id of flatScene.scene.characters) {
      ids.add(id);
    }
  }

  return [...ids];
}

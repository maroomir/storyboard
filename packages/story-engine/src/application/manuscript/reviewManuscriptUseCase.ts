import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import type { StoryUri, AssembledManuscript } from '@storyboard/story-model';
import {
  assembleManuscript,
  buildManuscriptReviewMarkdown,
  collectChapterPlanCharacterIds,
} from '@storyboard/story-model';
import { reviewChapterWindows, type ChapterWindowReviewResult } from '#engine/application/manuscript/reviewChapterWindows';
import type { ManuscriptReviewSource } from '#engine/application/manuscript/manuscriptRepositories';
import type { StoryboardAiService } from '@storyboard/story-ai';

export type ReviewManuscriptResult =
  | { readonly kind: 'missing_drafts'; readonly ok: false }
  | { readonly kind: 'missing_outline'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false }
  | {
      readonly kind: 'reviewed';
      readonly ok: true;
      readonly continuityCount: number;
      readonly critiqueCount: number;
      readonly reportUri: StoryUri;
    };

export interface ReviewManuscriptRequest {
  readonly workspaceRoot: StoryUri;
}

export class ReviewManuscriptUseCase implements IUseCase<
  ReviewManuscriptRequest,
  ReviewManuscriptResult
> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: ReviewManuscriptRequest): Promise<ReviewManuscriptResult> {
    const { workspaceRoot } = request;

    return await runUseCase<ReviewManuscriptResult>(
      this.host.logger,
      'Review manuscript failed',
      async () => await this.reviewManuscript(workspaceRoot),
    );
  }

  private async reviewManuscript(workspaceRoot: StoryUri): Promise<ReviewManuscriptResult> {
    if (!(await this.repositories.manuscriptReview.hasChapterPlan(workspaceRoot))) {
      return { kind: 'missing_outline', ok: false };
    }

    const reviewSource: ManuscriptReviewSource =
      await this.repositories.manuscriptReview.loadReviewSource(workspaceRoot, this.host.logger);
    const { source } = reviewSource;
    if (source.draftsByOrder.size === 0) {
      return { kind: 'missing_drafts', ok: false };
    }

    const manuscript: AssembledManuscript = assembleManuscript({
      draftsByOrder: source.draftsByOrder,
      plan: source.plan,
      projectName: source.projectName,
      annotateSceneStems: true,
    });
    const issues: ChapterWindowReviewResult = await this.reviewChapters(
      workspaceRoot,
      reviewSource,
      manuscript,
    );

    return await this.saveReport(workspaceRoot, manuscript, source.projectName, issues);
  }

  private async reviewChapters(
    workspaceRoot: StoryUri,
    reviewSource: ManuscriptReviewSource,
    manuscript: AssembledManuscript,
  ): Promise<ChapterWindowReviewResult> {
    const { source, styleConstraints, qualityCriteria, canonFactLines, chapterSummaries } =
      reviewSource;
    const characters: string[] = collectChapterPlanCharacterIds(source.plan);
    const aiService: StoryboardAiService = this.ai.gateway.createService(workspaceRoot);

    return await reviewChapterWindows({
      aiService,
      manuscript,
      storySoFar: chapterSummaries,
      canonFactLines,
      characters,
      styleConstraints,
      qualityCriteria,
      hasSceneMarkers: true,
      continuityProviderId: this.ai.gateway.getTaskProvider('continuityCheck'),
      critiqueProviderId: this.ai.gateway.getTaskProvider('draftCritique'),
    });
  }

  private async saveReport(
    workspaceRoot: StoryUri,
    manuscript: AssembledManuscript,
    projectName: string,
    issues: ChapterWindowReviewResult,
  ): Promise<ReviewManuscriptResult> {
    const { continuityIssues, critiqueIssues } = issues;
    const reportMarkdown: string = buildManuscriptReviewMarkdown({
      projectName,
      sceneCount: manuscript.includedCount,
      generatedAt: new Date().toISOString(),
      continuityIssues,
      critiqueIssues,
    });
    const reportUri: StoryUri = await this.repositories.manuscriptReview.saveReview(
      workspaceRoot,
      reportMarkdown,
    );

    return {
      kind: 'reviewed',
      ok: true,
      continuityCount: continuityIssues.length,
      critiqueCount: critiqueIssues.length,
      reportUri,
    };
  }
}

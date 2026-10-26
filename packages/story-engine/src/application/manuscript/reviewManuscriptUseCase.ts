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
import { reviewChapterWindows } from './reviewChapterWindows';
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
      async () => {
        if (!(await this.repositories.manuscriptReview.hasChapterPlan(workspaceRoot))) {
          return { kind: 'missing_outline', ok: false };
        }

        const { source, styleConstraints, qualityCriteria, canonFactLines, chapterSummaries } =
          await this.repositories.manuscriptReview.loadReviewSource(
            workspaceRoot,
            this.host.logger,
          );
        if (source.draftsByOrder.size === 0) {
          return { kind: 'missing_drafts', ok: false };
        }

        const manuscript: AssembledManuscript = assembleManuscript({
          draftsByOrder: source.draftsByOrder,
          plan: source.plan,
          projectName: source.projectName,
          annotateSceneStems: true,
        });
        const characters: string[] = collectChapterPlanCharacterIds(source.plan);
        const aiService: StoryboardAiService = this.ai.gateway.createService(workspaceRoot);

        const { continuityIssues, critiqueIssues } = await reviewChapterWindows({
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

        const reportMarkdown: string = buildManuscriptReviewMarkdown({
          projectName: source.projectName,
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
      },
    );
  }
}

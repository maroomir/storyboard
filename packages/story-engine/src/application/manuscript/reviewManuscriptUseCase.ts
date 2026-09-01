import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { StoryUri } from '@storyboard/story-format';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { assembleManuscript } from '@storyboard/story-format';
import { buildManuscriptReviewMarkdown } from '#engine/domain/manuscriptReview';
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
  hasChapterPlan(workspaceRoot: StoryUri): Promise<boolean>;
  loadReviewSource(
    workspaceRoot: StoryUri,
    logger: Pick<IStoryboardLogger, 'warn'>,
  ): Promise<ManuscriptReviewSource>;
  saveReview(workspaceRoot: StoryUri, markdown: string): Promise<StoryUri>;
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
      readonly reportUri: StoryUri;
    };

export class ReviewManuscriptUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly repository: IManuscriptReviewRepository,
    private readonly logger: IStoryboardLogger,
  ) {}

  public async execute(workspaceRoot: StoryUri): Promise<ReviewManuscriptResult> {
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

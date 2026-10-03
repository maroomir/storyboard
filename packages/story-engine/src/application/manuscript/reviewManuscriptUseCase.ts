import type { AiGateway } from '#engine/application/ai/aiGateway';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import type { StoryUri, ChapterPlan } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { assembleManuscript, flattenChapterPlan } from '@storyboard/story-model';
import { buildManuscriptReviewMarkdown } from '#engine/domain/manuscriptReview';
import type { ChapterSummary } from '#engine/domain/chapterSummaries';
import type { ManuscriptAssemblySource } from './assembleManuscriptUseCase';
import { reviewChapterWindows } from './reviewChapterWindows';

export type ManuscriptReviewSource = {
  readonly source: ManuscriptAssemblySource;
  readonly styleConstraints: readonly string[];
  readonly qualityCriteria: readonly string[];
  readonly canonFactLines: readonly string[];
  // 앞 장을 창에 실을 때 쓰는 장별 요약. 낡은 항목은 저장소가 걸러 낸다.
  readonly chapterSummaries: readonly ChapterSummary[];
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

export interface ReviewManuscriptUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly repository: IManuscriptReviewRepository;
  readonly logger: IStoryboardLogger;
}

export interface ReviewManuscriptRequest {
  readonly workspaceRoot: StoryUri;
}

export class ReviewManuscriptUseCase implements IUseCase<
  ReviewManuscriptRequest,
  ReviewManuscriptResult
> {
  public constructor(private readonly deps: ReviewManuscriptUseCaseDependencies) {}

  public async execute(request: ReviewManuscriptRequest): Promise<ReviewManuscriptResult> {
    const { workspaceRoot } = request;

    return await runUseCase<ReviewManuscriptResult>(
      this.deps.logger,
      'Review manuscript failed',
      async () => {
        if (!(await this.deps.repository.hasChapterPlan(workspaceRoot))) {
          return { kind: 'missing_outline', ok: false };
        }

        const { source, styleConstraints, qualityCriteria, canonFactLines, chapterSummaries } =
          await this.deps.repository.loadReviewSource(workspaceRoot, this.deps.logger);
        if (source.draftsByOrder.size === 0) {
          return { kind: 'missing_drafts', ok: false };
        }

        // 이슈가 어느 씬에서 나왔는지 짚어야 보고서에서 초안으로 되짚을 수 있다.
        const manuscript = assembleManuscript({
          draftsByOrder: source.draftsByOrder,
          plan: source.plan,
          projectName: source.projectName,
          annotateSceneStems: true,
        });
        const characters = collectCharacterIds(source.plan);
        const aiService = this.deps.aiGateway.createService(workspaceRoot);

        const { continuityIssues, critiqueIssues } = await reviewChapterWindows({
          aiService,
          manuscript,
          storySoFar: chapterSummaries,
          canonFactLines,
          characters,
          styleConstraints,
          qualityCriteria,
          hasSceneMarkers: true,
          continuityProviderId: this.deps.aiGateway.getTaskProvider('continuityCheck'),
          critiqueProviderId: this.deps.aiGateway.getTaskProvider('draftCritique'),
        });

        const reportMarkdown = buildManuscriptReviewMarkdown({
          projectName: source.projectName,
          sceneCount: manuscript.includedCount,
          generatedAt: new Date().toISOString(),
          continuityIssues,
          critiqueIssues,
        });
        const reportUri = await this.deps.repository.saveReview(workspaceRoot, reportMarkdown);

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

function collectCharacterIds(plan: ChapterPlan): string[] {
  const ids = new Set<string>();

  for (const flatScene of flattenChapterPlan(plan)) {
    for (const id of flatScene.scene.characters) {
      ids.add(id);
    }
  }

  return [...ids];
}

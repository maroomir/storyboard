import type { StoryUri, ChapterPlan } from '@storyboard/story-model';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import type { IStoryboardLogger } from '#engine/ports/logger';
import {
  assembleManuscript,
  type AssembledManuscript,
  type ManuscriptDraftEntry,
} from '@storyboard/story-model';
import {
  buildForeshadowingMarkdown,
  collectForeshadowing,
  countForeshadowing,
} from '#engine/domain/foreshadowingTracker';

export type ManuscriptAssemblySource = {
  readonly draftsByOrder: ReadonlyMap<number, ManuscriptDraftEntry>;
  readonly plan: ChapterPlan;
  readonly projectName: string;
};

export interface IManuscriptAssemblyRepository {
  hasChapterPlan(workspaceRoot: StoryUri): Promise<boolean>;
  loadAssemblySource(
    workspaceRoot: StoryUri,
    logger: Pick<IStoryboardLogger, 'warn'>,
  ): Promise<ManuscriptAssemblySource>;
  saveAssembly(
    workspaceRoot: StoryUri,
    manuscript: AssembledManuscript,
    foreshadowingMarkdown: string,
  ): Promise<StoryUri>;
}

export type AssembleManuscriptResult =
  | { readonly kind: 'missing_drafts'; readonly ok: false }
  | { readonly kind: 'missing_outline'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false }
  | {
      readonly kind: 'assembled';
      readonly ok: true;
      readonly result: {
        readonly chapterCount: number;
        readonly extraCount: number;
        readonly foreshadowingCount: number;
        readonly includedCount: number;
        readonly missingCount: number;
        readonly volumeUri: StoryUri;
      };
    };

export interface AssembleManuscriptUseCaseDependencies {
  readonly logger: IStoryboardLogger;
  readonly repository: IManuscriptAssemblyRepository;
}

export interface AssembleManuscriptRequest {
  readonly workspaceRoot: StoryUri;
}

export class AssembleManuscriptUseCase implements IUseCase<
  AssembleManuscriptRequest,
  AssembleManuscriptResult
> {
  public constructor(private readonly deps: AssembleManuscriptUseCaseDependencies) {}

  public async execute(request: AssembleManuscriptRequest): Promise<AssembleManuscriptResult> {
    const { workspaceRoot } = request;

    return await runUseCase<AssembleManuscriptResult>(
      this.deps.logger,
      'Assemble manuscript failed',
      async () => {
        if (!(await this.deps.repository.hasChapterPlan(workspaceRoot))) {
          return { kind: 'missing_outline', ok: false };
        }

        const source = await this.deps.repository.loadAssemblySource(
          workspaceRoot,
          this.deps.logger,
        );
        if (source.draftsByOrder.size === 0) {
          return { kind: 'missing_drafts', ok: false };
        }

        const manuscript = assembleManuscript({
          draftsByOrder: source.draftsByOrder,
          plan: source.plan,
          projectName: source.projectName,
        });
        const foreshadowing = collectForeshadowing(source.plan);
        const volumeUri = await this.deps.repository.saveAssembly(
          workspaceRoot,
          manuscript,
          buildForeshadowingMarkdown(source.projectName, foreshadowing),
        );

        return {
          kind: 'assembled',
          ok: true,
          result: {
            chapterCount: manuscript.chapters.length,
            extraCount: manuscript.extraCount,
            foreshadowingCount: countForeshadowing(foreshadowing),
            includedCount: manuscript.includedCount,
            missingCount: manuscript.missingCount,
            volumeUri,
          },
        };
      },
    );
  }
}

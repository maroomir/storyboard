import type { HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import type { StoryUri, ForeshadowingChapter } from '@storyboard/story-model';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import {
  assembleManuscript,
  type AssembledManuscript,
  buildForeshadowingMarkdown,
  collectForeshadowing,
  countForeshadowing,
} from '@storyboard/story-model';
import type { ManuscriptAssemblySource } from '#engine/application/manuscript/manuscriptRepositories';

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

export interface AssembleManuscriptRequest {
  readonly workspaceRoot: StoryUri;
}

export class AssembleManuscriptUseCase implements IUseCase<
  AssembleManuscriptRequest,
  AssembleManuscriptResult
> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: AssembleManuscriptRequest): Promise<AssembleManuscriptResult> {
    const { workspaceRoot } = request;

    return await runUseCase<AssembleManuscriptResult>(
      this.host.logger,
      'Assemble manuscript failed',
      async () => {
        if (!(await this.repositories.manuscriptAssembly.hasChapterPlan(workspaceRoot))) {
          return { kind: 'missing_outline', ok: false };
        }

        const source: ManuscriptAssemblySource =
          await this.repositories.manuscriptAssembly.loadAssemblySource(
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
        });
        const foreshadowing: ForeshadowingChapter[] = collectForeshadowing(source.plan);
        const volumeUri: StoryUri = await this.repositories.manuscriptAssembly.saveAssembly(
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

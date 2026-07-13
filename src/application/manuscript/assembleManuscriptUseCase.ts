import type * as vscode from 'vscode';

import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import {
  assembleManuscript,
  type AssembledManuscript,
  type ManuscriptDraftEntry,
} from '../../domain/manuscriptAssembly';
import {
  buildForeshadowingMarkdown,
  collectForeshadowing,
  countForeshadowing,
} from '../../domain/foreshadowingTracker';
import type { ChapterPlan } from '../../shared/outline';

export type ManuscriptAssemblySource = {
  readonly draftsByOrder: ReadonlyMap<number, ManuscriptDraftEntry>;
  readonly plan: ChapterPlan;
  readonly projectName: string;
};

export interface IManuscriptAssemblyRepository {
  hasChapterPlan(workspaceRoot: vscode.Uri): Promise<boolean>;
  loadAssemblySource(
    workspaceRoot: vscode.Uri,
    logger: Pick<StoryboardLogger, 'warn'>,
  ): Promise<ManuscriptAssemblySource>;
  saveAssembly(
    workspaceRoot: vscode.Uri,
    manuscript: AssembledManuscript,
    foreshadowingMarkdown: string,
  ): Promise<vscode.Uri>;
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
        readonly volumeUri: vscode.Uri;
      };
    };

export class AssembleManuscriptUseCase {
  public constructor(
    private readonly logger: StoryboardLogger,
    private readonly repository: IManuscriptAssemblyRepository,
  ) {}

  public async execute(workspaceRoot: vscode.Uri): Promise<AssembleManuscriptResult> {
    try {
      if (!(await this.repository.hasChapterPlan(workspaceRoot))) {
        return { kind: 'missing_outline', ok: false };
      }

      const source = await this.repository.loadAssemblySource(workspaceRoot, this.logger);
      if (source.draftsByOrder.size === 0) {
        return { kind: 'missing_drafts', ok: false };
      }

      const manuscript = assembleManuscript({
        draftsByOrder: source.draftsByOrder,
        plan: source.plan,
        projectName: source.projectName,
      });
      const foreshadowing = collectForeshadowing(source.plan);
      const volumeUri = await this.repository.saveAssembly(
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
    } catch (error) {
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }
}

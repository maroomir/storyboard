import type { IStoryboardLogger } from '#engine/ports/logger';
import type {
  AssembledManuscript,
  ChapterPlan,
  ChapterSummary,
  ManuscriptDraftEntry,
  StoryUri,
} from '@storyboard/story-model';

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

export type ManuscriptExportSource = {
  readonly markdown: string;
  readonly projectName: string;
};

export interface IManuscriptExportRepository {
  hasManuscriptVolume(workspaceRoot: StoryUri): Promise<boolean>;
  loadVolume(workspaceRoot: StoryUri): Promise<ManuscriptExportSource>;
  saveExport(targetUri: StoryUri, content: string): Promise<void>;
}

export type ManuscriptReviewSource = {
  readonly source: ManuscriptAssemblySource;
  readonly styleConstraints: readonly string[];
  readonly qualityCriteria: readonly string[];
  readonly canonFactLines: readonly string[];
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

export interface IChapterSummaryRepository {
  hasChapterPlan(workspaceRoot: StoryUri): Promise<boolean>;
  loadAssemblySource(workspaceRoot: StoryUri): Promise<ManuscriptAssemblySource>;
  readChapterSummaries(workspaceRoot: StoryUri): Promise<string | undefined>;
  saveChapterSummaries(workspaceRoot: StoryUri, markdown: string): Promise<StoryUri>;
}

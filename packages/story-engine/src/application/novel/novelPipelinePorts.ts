import type {
  ManuscriptDraftEntry,
  StoryUri,
  ChapterPlan,
  OutlineCharacterBrief,
  OutlineSynopsis,
  StoryboardProject,
  GeneratedSceneSeed,
  ChapterSummary,
  NovelRunState,
} from '@storyboard/story-model';
export interface INovelRunStateRepository {
  readExisting(workspaceRoot: StoryUri): Promise<NovelRunState | undefined>;
  loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject>;
  save(workspaceRoot: StoryUri, state: NovelRunState): Promise<void>;
}

export interface INovelOutlineRepository {
  hasChapterPlan(workspaceRoot: StoryUri): Promise<boolean>;
  loadCharacterBriefs(workspaceRoot: StoryUri): Promise<readonly OutlineCharacterBrief[]>;
  loadChapterPlan(workspaceRoot: StoryUri): Promise<ChapterPlan>;
  loadSynopsis(workspaceRoot: StoryUri): Promise<OutlineSynopsis | undefined>;
  saveSynopsis(workspaceRoot: StoryUri, synopsis: OutlineSynopsis): Promise<void>;
  save(
    workspaceRoot: StoryUri,
    synopsis: OutlineSynopsis,
    chapterPlan: ChapterPlan,
  ): Promise<StoryUri>;
}

export interface ISceneSeedRepository {
  saveSeeds(workspaceRoot: StoryUri, seeds: readonly GeneratedSceneSeed[]): Promise<void>;
  listSceneStemsByOrder(workspaceRoot: StoryUri): Promise<ReadonlyMap<number, string>>;
  saveMissingSeeds(workspaceRoot: StoryUri, seeds: readonly GeneratedSceneSeed[]): Promise<number>;
}

export interface NovelReviewSource {
  readonly draftsByOrder: ReadonlyMap<number, ManuscriptDraftEntry>;
  readonly canonFactLines: readonly string[];
  readonly chapterSummaries: readonly ChapterSummary[];
}

export interface INovelReviewRepository {
  loadReviewSource(workspaceRoot: StoryUri): Promise<NovelReviewSource>;
  saveReview(workspaceRoot: StoryUri, markdown: string): Promise<void>;
}

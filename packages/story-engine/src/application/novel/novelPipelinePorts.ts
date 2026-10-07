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
  save(
    workspaceRoot: StoryUri,
    synopsis: OutlineSynopsis,
    chapterPlan: ChapterPlan,
  ): Promise<StoryUri>;
}

export interface ISceneSeedRepository {
  saveSeeds(workspaceRoot: StoryUri, seeds: readonly GeneratedSceneSeed[]): Promise<void>;
  // Writes only the seeds whose scene card does not exist yet and returns how many it wrote.
  saveMissingSeeds(workspaceRoot: StoryUri, seeds: readonly GeneratedSceneSeed[]): Promise<number>;
}

export interface NovelReviewSource {
  readonly draftsByOrder: ReadonlyMap<number, ManuscriptDraftEntry>;
  readonly canonFactLines: readonly string[];
  // 앞 장을 검수 창에 실을 때 쓰는 장별 요약. 낡은 항목은 저장소가 걸러 낸다.
  readonly chapterSummaries: readonly ChapterSummary[];
}

export interface INovelReviewRepository {
  loadReviewSource(workspaceRoot: StoryUri): Promise<NovelReviewSource>;
  saveReview(workspaceRoot: StoryUri, markdown: string): Promise<void>;
}

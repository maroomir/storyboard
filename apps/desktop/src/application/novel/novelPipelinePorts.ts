import type { ManuscriptDraftEntry } from '@storyboard/story-format';
import type { GeneratedSceneSeed, StoryUri } from '@storyboard/story-engine';
import type { NovelRunState } from '@storyboard/story-engine';
import type {
  ChapterPlan,
  OutlineCharacterBrief,
  OutlineSynopsis,
  StoryboardProject,
} from '@storyboard/story-format';
export interface INovelRunStateRepository {
  readExisting(workspaceRoot: StoryUri): Promise<NovelRunState | undefined>;
  loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject>;
  save(workspaceRoot: StoryUri, state: NovelRunState): Promise<void>;
}

export interface INovelOutlineRepository {
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
}

export interface NovelReviewSource {
  readonly draftsByOrder: ReadonlyMap<number, ManuscriptDraftEntry>;
  readonly canonFactLines: readonly string[];
}

export interface INovelReviewRepository {
  loadReviewSource(workspaceRoot: StoryUri): Promise<NovelReviewSource>;
  saveReview(workspaceRoot: StoryUri, markdown: string): Promise<void>;
}

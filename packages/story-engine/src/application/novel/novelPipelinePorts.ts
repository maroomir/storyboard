import type { ManuscriptDraftEntry } from '@storyboard/story-format';
import type { GeneratedSceneSeed } from '#engine/domain/sceneSeedFactory';
import type { StoryUri } from '@storyboard/story-format';
import type { NovelRunState } from '#engine/domain/files/novelRunState';
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

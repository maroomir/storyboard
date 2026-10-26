import type { BibleCandidateRecord, StoryBible, StoryUri } from '@storyboard/story-model';

export interface IBibleCandidateRepository {
  loadCanon(workspaceRoot: StoryUri): Promise<StoryBible>;
  loadRecords(workspaceRoot: StoryUri): Promise<readonly BibleCandidateRecord[]>;
  saveCanon(workspaceRoot: StoryUri, canon: StoryBible): Promise<void>;
}

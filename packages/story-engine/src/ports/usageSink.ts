import type { UsageRecord, StoryUri } from '@storyboard/story-model';

export interface IUsageSink {
  record(workspaceRoot: StoryUri, usage: UsageRecord): Promise<void>;
}

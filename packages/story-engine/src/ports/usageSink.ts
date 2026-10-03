import type { UsageRecord, StoryUri } from '@storyboard/story-model';

// Where a provider call's token cost goes. The extension persists it to the workspace ledger and
// refreshes its usage view; a CLI may simply print a running total.
export interface IUsageSink {
  record(workspaceRoot: StoryUri, usage: UsageRecord): Promise<void>;
}

import type { UsageRecord } from '@storyboard/story-ai';
import type { StoryUri } from '@storyboard/story-format';

// Where a provider call's token cost goes. The extension persists it to the workspace ledger and
// refreshes its usage view; a CLI may simply print a running total.
export interface IUsageSink {
  record(workspaceRoot: StoryUri, usage: UsageRecord): Promise<void>;
}

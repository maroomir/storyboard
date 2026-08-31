import type { StoryUri, StoryboardLogger, UsageSink } from '@storyboard/story-engine';
import type { UsageRecord } from '@storyboard/story-ai';

import type { UsageRecorder } from './UsageRecorder';

// NOTE: accounting must never fail a generation the author already paid for, so a ledger write that
// throws is logged and swallowed here rather than surfacing to the pipeline.
export function createUsageSink(recorder: UsageRecorder, logger: StoryboardLogger): UsageSink {
  return {
    record: async (workspaceRoot: StoryUri, usage: UsageRecord): Promise<void> => {
      try {
        await recorder.record(workspaceRoot as never, usage);
      } catch (error) {
        logger.error('사용량 기록에 실패했습니다.', error);
      }
    },
  };
}

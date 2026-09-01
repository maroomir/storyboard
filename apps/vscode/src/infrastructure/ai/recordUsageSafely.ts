import type * as vscode from 'vscode';

import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { UsageRecorder } from './UsageRecorder';
import type { UsageRecord } from '@storyboard/story-ai';

export function recordUsageSafely(
  recorder: UsageRecorder,
  workspaceRoot: vscode.Uri,
  record: UsageRecord,
  logger: Pick<IStoryboardLogger, 'error'>,
): void {
  void recorder.record(workspaceRoot, record).catch((error: unknown) => {
    logger.error('Failed to record AI usage', error);
  });
}

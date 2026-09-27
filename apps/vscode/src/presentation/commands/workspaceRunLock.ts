import { hostname } from 'node:os';

import * as vscode from 'vscode';

import {
  acquireWorkspaceRunLock,
  describeWorkspaceRunLockHolder,
  type IFileSystem,
} from '@storyboard/story-engine';

// Long generation writes drafts, cards and memory for minutes. The desktop app and the CLI take
// the same lock, so two of them never rewrite one workspace at once.
export async function runHoldingWorkspaceLock(
  fileSystem: IFileSystem,
  workspaceRoot: vscode.Uri,
  label: string,
  run: () => PromiseLike<void>,
): Promise<void> {
  const acquired = await acquireWorkspaceRunLock({
    fileSystem,
    workspaceRoot,
    holder: { owner: 'vscode', label, pid: process.pid, hostname: hostname() },
  });

  if (!acquired.ok) {
    await vscode.window.showWarningMessage(
      `${describeWorkspaceRunLockHolder(acquired.heldBy)}. 끝난 뒤 다시 실행해 주세요.`,
    );
    return;
  }

  try {
    await run();
  } finally {
    await acquired.lock.release();
  }
}

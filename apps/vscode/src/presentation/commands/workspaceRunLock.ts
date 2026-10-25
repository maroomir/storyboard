import * as vscode from 'vscode';

import type { RunGate, WorkspaceHoldResult } from '@storyboard/story-app';

export async function runHoldingWorkspaceLock(
  runGate: Pick<RunGate, 'hold'>,
  workspaceRoot: vscode.Uri,
  label: string,
  run: () => PromiseLike<void>,
): Promise<void> {
  const held: WorkspaceHoldResult<void> = await runGate.hold(workspaceRoot, label, async () => {
    await run();
  });

  if (!held.ok) {
    await vscode.window.showWarningMessage(`${held.message}. 끝난 뒤 다시 실행해 주세요.`);
  }
}

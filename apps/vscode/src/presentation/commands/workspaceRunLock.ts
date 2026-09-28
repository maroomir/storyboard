import * as vscode from 'vscode';

import type { RunGate } from '@storyboard/story-app';

// Long generation writes drafts, cards and memory for minutes. The desktop app and the CLI take
// the same lock, so two of them never rewrite one workspace at once.
export async function runHoldingWorkspaceLock(
  runGate: Pick<RunGate, 'hold'>,
  workspaceRoot: vscode.Uri,
  label: string,
  run: () => PromiseLike<void>,
): Promise<void> {
  const held = await runGate.hold(workspaceRoot, label, async () => {
    await run();
  });

  if (!held.ok) {
    await vscode.window.showWarningMessage(`${held.message}. 끝난 뒤 다시 실행해 주세요.`);
  }
}

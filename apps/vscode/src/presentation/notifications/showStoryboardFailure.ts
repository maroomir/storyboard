import * as vscode from 'vscode';

import { missingProviderMessage } from '@storyboard/story-ai';

import { chooseProviderCommand } from '@/presentation/commands/chooseProvider';

const missingApiKeyMarker = 'API 키가 설정되어 있지 않습니다';

interface FailureAction {
  readonly label: string;
  readonly command: string;
}

// Use cases hand back a message, not an error code, so the two setup failures an author can fix
// on the spot are recognised by their text and get a button that opens the fix.
function resolveFailureAction(message: string): FailureAction | undefined {
  if (message.includes(missingProviderMessage)) {
    return { label: '제공자 선택', command: chooseProviderCommand };
  }

  if (message.includes(missingApiKeyMarker)) {
    return { label: '설정 열기', command: 'storyboard.settings.open' };
  }

  return undefined;
}

export async function showStoryboardFailure(message: string): Promise<void> {
  const action = resolveFailureAction(message);

  if (!action) {
    await vscode.window.showErrorMessage(message);
    return;
  }

  const choice = await vscode.window.showErrorMessage(message, action.label);

  if (choice === action.label) {
    await vscode.commands.executeCommand(action.command);
  }
}

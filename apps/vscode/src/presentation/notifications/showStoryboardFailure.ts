import * as vscode from 'vscode';

import { missingApiKeyMarker, missingProviderMessage } from '@storyboard/story-ai';

import { chooseProviderCommand } from '@/presentation/commands/chooseProvider';
import { openSettingsCommand } from '@/presentation/commands/openSettings';

interface FailureAction {
  readonly label: string;
  readonly command: string;
}

// NOTE: 유즈케이스는 오류 코드가 아니라 문구를 돌려주므로, 창작자가 그 자리에서 고칠 수 있는 두
// 실패는 문구로 알아본다. 그래서 두 문구 모두 story-ai 가 내보내는 상수여야 한다 — 여기서 베껴
// 적으면 프로바이더 쪽 문구가 바뀌는 순간 버튼이 조용히 사라진다.
function resolveFailureAction(message: string): FailureAction | undefined {
  if (message.includes(missingProviderMessage)) {
    return { label: '제공자 선택', command: chooseProviderCommand };
  }

  if (message.includes(missingApiKeyMarker)) {
    return { label: '설정 열기', command: openSettingsCommand };
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

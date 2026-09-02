import * as vscode from 'vscode';

import type { ConfigBridge } from '@storyboard/story-ai';

import { chooseProviderCommand } from '@/presentation/commands/chooseProvider';
import type { SettingsConfigFiles } from '@/presentation/messaging/settingsRpcHandlers';

export interface ProviderStatusBarDependencies {
  readonly configBridge: ConfigBridge;
  readonly configFiles: () => SettingsConfigFiles;
}

const originLabels = {
  default: '기본값',
  user: '공통 설정',
  workspace: '이 작품 설정',
} as const;

export function describeProviderStatus(deps: ProviderStatusBarDependencies): {
  readonly text: string;
  readonly tooltip: string;
  readonly command: string;
} {
  if (!deps.configBridge.isDefaultProviderConfigured()) {
    return {
      text: '$(warning) AI 제공자 선택',
      tooltip: 'Storyboard 가 쓸 기본 AI 제공자를 아직 고르지 않았습니다. 클릭해서 고르세요.',
      command: chooseProviderCommand,
    };
  }

  const providerId = deps.configBridge.getDefaultProvider();
  const model = deps.configBridge.getProviderConfig(providerId).model ?? '';
  const origin = deps.configBridge.getValueOrigin('defaultProvider');
  const files = deps.configFiles();
  const file = origin === 'workspace' ? (files.workspace ?? files.user) : files.user;

  return {
    text: `$(sparkle) ${providerId}${model ? ` · ${model}` : ''}`,
    tooltip: `Storyboard 기본 AI: ${providerId}${model ? ` / ${model}` : ''}\n출처: ${originLabels[origin]}${origin === 'default' ? '' : ` (${file})`}\n클릭하면 설정을 엽니다.`,
    command: 'storyboard.settings.open',
  };
}

// The one place outside the settings panel that shows which provider a generation will use, so an
// author never has to open the panel just to confirm a change took.
export function registerProviderStatusBarItem(
  deps: ProviderStatusBarDependencies,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);

  const refresh = (): void => {
    const status = describeProviderStatus(deps);
    item.text = status.text;
    item.tooltip = status.tooltip;
    item.command = status.command;
  };

  refresh();
  item.show();

  const subscription = deps.configBridge.onDidChange(refresh);

  return vscode.Disposable.from(item, subscription);
}

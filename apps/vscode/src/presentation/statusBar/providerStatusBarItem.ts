import * as vscode from 'vscode';

import type { ConfigBridge } from '@storyboard/story-ai';

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
} {
  const providerId = deps.configBridge.getDefaultProvider();
  const model = deps.configBridge.getProviderConfig(providerId).model ?? '';
  const origin = deps.configBridge.getValueOrigin('defaultProvider');
  const files = deps.configFiles();
  const file = origin === 'workspace' ? (files.workspace ?? files.user) : files.user;

  return {
    text: `$(sparkle) ${providerId}${model ? ` · ${model}` : ''}`,
    tooltip: `Storyboard 기본 AI: ${providerId}${model ? ` / ${model}` : ''}\n출처: ${originLabels[origin]}${origin === 'default' ? '' : ` (${file})`}\n클릭하면 설정을 엽니다.`,
  };
}

// The one place outside the settings panel that shows which provider a generation will use, so an
// author never has to open the panel just to confirm a change took.
export function registerProviderStatusBarItem(
  deps: ProviderStatusBarDependencies,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'storyboard.settings.open';

  const refresh = (): void => {
    const status = describeProviderStatus(deps);
    item.text = status.text;
    item.tooltip = status.tooltip;
  };

  refresh();
  item.show();

  const subscription = deps.configBridge.onDidChange(refresh);

  return vscode.Disposable.from(item, subscription);
}

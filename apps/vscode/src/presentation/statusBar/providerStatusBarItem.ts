import type {
  ConfigValueOrigin,
  DisposableHandle,
  SettingsConfigFiles,
} from '@storyboard/story-model';
import * as vscode from 'vscode';

import type { ConfigBridge } from '@storyboard/story-ai';

import { chooseProviderCommand } from '@/presentation/commands/chooseProvider';
import { openSettingsCommand } from '@/presentation/commands/openSettings';
import type { AiProviderId } from '@storyboard/story-model';

export interface ProviderStatusBarDependencies {
  readonly configBridge: ConfigBridge;
  readonly configFiles: () => SettingsConfigFiles;
}

const originLabels: Readonly<Record<ConfigValueOrigin, string>> = {
  default: '기본값',
  user: '공통 설정',
  workspace: '이 작품 설정',
};

export interface ProviderStatusText {
  readonly text: string;
  readonly tooltip: string;
  readonly command: string;
}

export function describeProviderStatus(deps: ProviderStatusBarDependencies): ProviderStatusText {
  if (!deps.configBridge.isDefaultProviderConfigured()) {
    return {
      text: '$(warning) AI 제공자 선택',
      tooltip: 'Storyboard 가 쓸 기본 AI 제공자를 아직 고르지 않았습니다. 클릭해서 고르세요.',
      command: chooseProviderCommand,
    };
  }

  const providerId: AiProviderId = deps.configBridge.getDefaultProvider();
  const model: string = deps.configBridge.getProviderConfig(providerId).model ?? '';
  const origin: ConfigValueOrigin = deps.configBridge.getValueOrigin('ai.provider.default');
  const files: SettingsConfigFiles = deps.configFiles();
  const file: string = origin === 'workspace' ? (files.workspace ?? files.user) : files.user;

  return {
    text: `$(sparkle) ${providerId}${model ? ` · ${model}` : ''}`,
    tooltip: `Storyboard 기본 AI: ${providerId}${model ? ` / ${model}` : ''}\n출처: ${originLabels[origin]}${origin === 'default' ? '' : ` (${file})`}\n클릭하면 설정을 엽니다.`,
    command: openSettingsCommand,
  };
}

export function registerProviderStatusBarItem(
  deps: ProviderStatusBarDependencies,
): vscode.Disposable {
  const item: vscode.StatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );

  const refresh = (): void => {
    const status: ProviderStatusText = describeProviderStatus(deps);
    item.text = status.text;
    item.tooltip = status.tooltip;
    item.command = status.command;
  };

  refresh();
  item.show();

  const subscription: DisposableHandle = deps.configBridge.onDidChange(refresh);

  return vscode.Disposable.from(item, subscription);
}

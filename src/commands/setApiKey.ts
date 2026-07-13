import * as vscode from 'vscode';

import { aiProviderIds, type AiProviderId } from '../shared/aiTypes';
import { SecretStore } from '../services/secrets/SecretStore';

const setApiKeyCommand = 'storyboard.apiKey.set';
const apiKeyProviderIds = aiProviderIds.filter((providerId) => providerId !== 'mock');

export interface RegisterSetApiKeyCommandDependencies {
  readonly secretStore: SecretStore;
}

export function registerSetApiKeyCommand(
  dependencies: RegisterSetApiKeyCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(setApiKeyCommand, () =>
    setApiKey(dependencies.secretStore),
  );
}

async function setApiKey(secretStore: SecretStore): Promise<void> {
  const providerId = await pickProvider();

  if (!providerId) {
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    title: `${providerId} API Key`,
    prompt: '저장할 API 키를 입력하세요. 비워 두고 확인하면 기존 키를 삭제합니다.',
    password: true,
    ignoreFocusOut: true,
  });

  if (apiKey === undefined) {
    return;
  }

  if (apiKey.trim().length === 0) {
    await secretStore.deleteApiKey(providerId);
    await vscode.window.showInformationMessage(`Storyboard ${providerId} API 키를 삭제했습니다.`);
    return;
  }

  await secretStore.setApiKey(providerId, apiKey);
  await vscode.window.showInformationMessage(`Storyboard ${providerId} API 키를 저장했습니다.`);
}

async function pickProvider(): Promise<AiProviderId | undefined> {
  const selectedProvider = await vscode.window.showQuickPick(
    apiKeyProviderIds.map((providerId) => ({ label: providerId, providerId })),
    {
      title: 'API 키를 설정할 Provider 선택',
      placeHolder: 'Provider를 선택하세요.',
    },
  );

  return selectedProvider?.providerId;
}

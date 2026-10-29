import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import { aiProviderIds, requiresApiKey } from '@storyboard/story-model';
import { SecretStore } from '@storyboard/story-ai';
import type { AiProviderId } from '@storyboard/story-model';
const apiKeyProviderIds: AiProviderId[] = aiProviderIds.filter(requiresApiKey);

export interface SetApiKeyCommandDependencies {
  readonly secretStore: SecretStore;
}

export class SetApiKeyCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.apiKeySet;

  public constructor(private readonly dependencies: SetApiKeyCommandDependencies) {}

  public run(): unknown {
    return setApiKey(this.dependencies.secretStore);
  }
}

async function setApiKey(secretStore: SecretStore): Promise<void> {
  const providerId: AiProviderId | undefined = await pickProvider();

  if (!providerId) {
    return;
  }

  const apiKey: string | undefined = await vscode.window.showInputBox({
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

interface ProviderPick extends vscode.QuickPickItem {
  readonly providerId: AiProviderId;
}

async function pickProvider(): Promise<AiProviderId | undefined> {
  const selectedProvider: ProviderPick | undefined = await vscode.window.showQuickPick(
    apiKeyProviderIds.map((providerId) => ({ label: providerId, providerId })),
    {
      title: 'API 키를 설정할 Provider 선택',
      placeHolder: 'Provider를 선택하세요.',
    },
  );

  return selectedProvider?.providerId;
}

import * as vscode from 'vscode';

import { aiProviderIds, isCliProvider, requiresApiKey } from '@storyboard/story-ai';
import type {
  AiProviderId,
  AiProviderRegistry,
  ConfigBridge,
  SecretStore,
} from '@storyboard/story-ai';

export const chooseProviderCommand = 'storyboard.provider.choose';

export interface ChooseProviderDependencies {
  readonly configBridge: ConfigBridge;
  readonly registry: AiProviderRegistry;
  readonly secretStore: SecretStore;
}

interface ProviderPickItem extends vscode.QuickPickItem {
  readonly providerId: AiProviderId;
}

// The first thing a new install has to decide. Picking a keyed provider flows straight into the
// key prompt so the author is not sent to a second command to finish the job.
export async function chooseDefaultProvider(
  deps: ChooseProviderDependencies,
): Promise<AiProviderId | undefined> {
  const statuses = await deps.registry.listProviders();
  const current = deps.configBridge.isDefaultProviderConfigured()
    ? deps.configBridge.getDefaultProvider()
    : undefined;

  const items: ProviderPickItem[] = aiProviderIds.map((providerId) => {
    const status = statuses.find((entry) => entry.providerId === providerId);
    const notes: string[] = [];

    if (providerId === current) {
      notes.push('현재 기본');
    }

    if (isCliProvider(providerId)) {
      notes.push('구독 CLI · API 키 불필요');
    } else if (providerId === 'ollama') {
      notes.push('로컬');
    } else if (providerId === 'mock') {
      notes.push('가짜 텍스트 · 흐름 확인용');
    } else {
      notes.push(status?.hasApiKey ? 'API 키 저장됨' : 'API 키 필요');
    }

    return {
      providerId,
      label: status?.displayName ?? providerId,
      description: notes.join(' · '),
      ...(status?.model ? { detail: `모델: ${status.model}` } : {}),
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Storyboard 기본 AI 제공자',
    placeHolder: '초안·검수·Studio 가 기본으로 쓸 제공자를 고르세요',
    ignoreFocusOut: true,
  });

  if (!picked) {
    return undefined;
  }

  await deps.configBridge.setDefaultProvider(picked.providerId);

  if (requiresApiKey(picked.providerId) && !(await deps.secretStore.hasApiKey(picked.providerId))) {
    const apiKey = await vscode.window.showInputBox({
      title: `${picked.label} API 키`,
      prompt:
        '키를 입력하면 ~/.storyboard/secrets.json 에 저장됩니다. 비워 두면 나중에 설정에서 넣을 수 있습니다.',
      password: true,
      ignoreFocusOut: true,
    });

    if (apiKey !== undefined && apiKey.trim().length > 0) {
      await deps.secretStore.setApiKey(picked.providerId, apiKey);
    }
  }

  void vscode.window.showInformationMessage(
    `Storyboard 기본 AI 제공자를 ${picked.label} 로 설정했습니다.`,
  );
  return picked.providerId;
}

export function registerChooseProviderCommand(deps: ChooseProviderDependencies): vscode.Disposable {
  return vscode.commands.registerCommand(chooseProviderCommand, () => chooseDefaultProvider(deps));
}

// Shown once per activation in a Storyboard workspace that has never chosen a provider, so the
// first "Generate" does not end in an error the author has to decode.
export async function nudgeToChooseProvider(deps: ChooseProviderDependencies): Promise<void> {
  if (deps.configBridge.isDefaultProviderConfigured()) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    'Storyboard 가 쓸 AI 제공자를 아직 고르지 않았습니다. 고르기 전에는 초안 생성이 실행되지 않습니다.',
    '제공자 선택',
    '나중에',
  );

  if (choice === '제공자 선택') {
    await chooseDefaultProvider(deps);
  }
}

import {
  getProviderTransport,
  listSelectableProviderIds,
  requiresApiKey,
  type AiProviderId,
} from '@storyboard/story-model';

import { flagString } from '@/cliArguments';
import type { CliContainer } from '@/container';
import type { CommandContext, CommandOutcome } from './outcome';
import { signIn } from './login';
import { askLine, askSecret } from './prompt';
import { enabledHiddenProviderIds } from '@/adapters/availableProviders';
import type { StoryboardHomePaths } from '@storyboard/story-config';
import { failure, success } from '@/commands/outcomes';

function describeProvider(providerId: AiProviderId): string {
  if (providerId === 'ollama') {
    return '로컬';
  }
  if (providerId === 'mock') {
    return '가짜 텍스트 · 흐름 확인용';
  }
  if (!requiresApiKey(providerId)) {
    return '구독 로그인';
  }
  return 'API 키 필요';
}

async function chooseProviderInteractively(
  current: AiProviderId | undefined,
): Promise<AiProviderId | undefined> {
  const selectableProviderIds: AiProviderId[] = listSelectableProviderIds(
    current,
    enabledHiddenProviderIds(),
  );

  process.stderr.write('Storyboard 가 기본으로 쓸 AI 프로바이더를 고르세요.\n');
  selectableProviderIds.forEach((providerId, index) => {
    const marker: '' | ' (현재)' = providerId === current ? ' (현재)' : '';
    process.stderr.write(
      `  ${index + 1}. ${providerId.padEnd(12)} ${describeProvider(providerId)}${marker}\n`,
    );
  });

  const answer: string = await askLine('번호 또는 이름 (엔터로 취소): ');

  if (answer.length === 0) {
    return undefined;
  }

  const byIndex: AiProviderId | undefined = selectableProviderIds[Number(answer) - 1];

  if (byIndex !== undefined) {
    return byIndex;
  }

  return selectableProviderIds.find((providerId) => providerId === answer);
}

export async function runSetup({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge, secretStore } = container;
  const flagProvider: string | undefined = flagString(args.flags, 'provider');
  const current: AiProviderId | undefined = configBridge.isDefaultProviderConfigured()
    ? configBridge.getDefaultProvider()
    : undefined;

  let providerId: AiProviderId | undefined;

  if (flagProvider !== undefined) {
    providerId = flagProvider as AiProviderId;
  } else if (container.canPrompt) {
    providerId = await chooseProviderInteractively(current);
  } else {
    return failure(
      '터미널이 아니어서 질문할 수 없습니다. `storyboard setup --provider <id>` 로 지정해 주세요.',
    );
  }

  if (providerId === undefined) {
    return failure('프로바이더를 고르지 않아 설정을 바꾸지 않았습니다.');
  }

  await configBridge.setDefaultProvider(providerId);

  const model: string | undefined = flagString(args.flags, 'model');

  if (model !== undefined) {
    await configBridge.setProviderModel(providerId, model);
  }

  let keyStored: boolean = false;

  if (requiresApiKey(providerId) && !(await secretStore.hasApiKey(providerId))) {
    if (container.canPrompt) {
      const key: string = await askSecret(
        `${providerId} API 키 (비워 두면 나중에 apikey set 으로): `,
      );

      if (key.trim().length > 0) {
        await secretStore.setApiKey(providerId, key);
        keyStored = true;
      }
    } else {
      process.stderr.write(
        `[warn] ${providerId} 는 API 키가 필요합니다: echo "$KEY" | storyboard apikey set ${providerId}\n`,
      );
    }
  }

  const home: StoryboardHomePaths = container.homePaths;
  const loginNote: CommandOutcome | undefined = await signInIfNeeded(container, providerId);

  if (loginNote !== undefined && !loginNote.ok) {
    return loginNote;
  }

  return success(
    `기본 프로바이더를 ${providerId} 로 저장했습니다: ${container.configWriteFile}` +
      (keyStored ? `\nAPI 키를 저장했습니다: ${home.secretsFile}` : '') +
      (loginNote === undefined ? '' : `\n${loginNote.message}`),
    {
      providerId,
      model: configBridge.getProviderConfig(providerId).model,
      keyStored,
      file: container.configWriteFile,
    },
  );
}

async function signInIfNeeded(
  container: CliContainer,
  providerId: AiProviderId,
): Promise<CommandOutcome | undefined> {
  if (getProviderTransport(providerId) !== 'oauth') {
    return undefined;
  }

  if ((await container.secretStore.getOAuthConnection(providerId))?.tokens !== undefined) {
    return undefined;
  }

  return container.canPrompt
    ? signIn(container, providerId)
    : success(`${providerId} 는 로그인이 필요합니다: storyboard login ${providerId}`);
}

import { availableProviderIds } from '@/adapters/availableProviders';
import type { CommandHandler } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import { askLine, askSecret, readStdin } from '@/commands/prompt';
import type { CliContainer } from '@/container';
import type { OAuthConnection } from '@storyboard/story-ai';
import {
  extractErrorMessage,
  getProviderTransport,
  requiresApiKey,
  type AiProviderId,
} from '@storyboard/story-model';

export const setApiKey: CommandHandler = async ({ container, args }) => {
  const provider: string | undefined = await resolveApiKeyProvider(container, args.positionals[0]);

  if (typeof provider === 'string' && !availableProviderIds().includes(provider as AiProviderId)) {
    return failure(provider);
  }
  if (provider === undefined) {
    return failure(`프로바이더를 지정해 주세요: ${availableProviderIds().join(', ')}`);
  }

  const providerId: AiProviderId = provider as AiProviderId;
  const key: string = (
    process.stdin.isTTY && container.canPrompt
      ? await askSecret(
          `${providerId} API 키를 붙여 넣고 Enter (입력은 화면에 보이지 않습니다. 비워 두면 삭제): `,
        )
      : await readStdin()
  ).trim();

  if (key.length === 0) {
    await container.secretStore.deleteApiKey(providerId);
    return success(`${providerId} API 키를 지웠습니다.`);
  }

  await container.secretStore.setApiKey(providerId, key);

  try {
    await container.aiProviderRegistry.checkConnection(providerId);
    return success(
      `${providerId} API 키를 저장하고 연결을 확인했습니다: ${container.homePaths.secretsFile}`,
      { providerId, verified: true },
    );
  } catch (error) {
    const reason: string = extractErrorMessage(error);
    return success(
      [
        `${providerId} API 키를 저장했지만 연결 확인에 실패했습니다: ${reason}`,
        '키가 맞는지, 네트워크가 닿는지 보고 다시 apikey set 을 실행하세요.',
      ].join('\n'),
      { providerId, verified: false },
    );
  }
};

export const showApiKeys: CommandHandler = async ({ container }) => {
  const rows: { readonly providerId: AiProviderId; readonly stored: boolean }[] = [];
  const logins: {
    readonly providerId: AiProviderId;
    readonly isLoggedIn: boolean;
    readonly accountLabel: string | null;
    readonly expiresAt: string | null;
  }[] = [];

  for (const providerId of availableProviderIds()) {
    if (requiresApiKey(providerId)) {
      rows.push({ providerId, stored: await container.secretStore.hasApiKey(providerId) });
    } else if (getProviderTransport(providerId) === 'oauth') {
      const connection: OAuthConnection | undefined =
        await container.secretStore.getOAuthConnection(providerId);
      logins.push({
        providerId,
        isLoggedIn: connection?.tokens !== undefined,
        accountLabel: connection?.registration?.email ?? null,
        expiresAt: connection?.tokens?.expiresAt ?? null,
      });
    }
  }

  const describeLogin = (login: (typeof logins)[number]): string => {
    if (!login.isLoggedIn) {
      return `     ${login.providerId}  로그인 안 됨`;
    }
    const account: string = login.accountLabel === null ? '' : ` (${login.accountLabel})`;
    return `  ✅ ${login.providerId}  로그인됨${account}`;
  };

  return success(
    [
      `API 키 (${container.homePaths.secretsFile})`,
      ...rows.map(
        (row) =>
          `  ${row.stored ? '✅' : '  '} ${row.providerId}${row.stored ? '  저장됨' : '  없음'}`,
      ),
      ...(logins.length === 0 ? [] : ['', '로그인', ...logins.map(describeLogin)]),
    ].join('\n'),
    { keys: rows, logins },
  );
};

async function resolveApiKeyProvider(
  container: CliContainer,
  given: string | undefined,
): Promise<string | undefined> {
  if (given !== undefined) {
    return availableProviderIds().includes(given as AiProviderId)
      ? given
      : `모르는 프로바이더입니다: ${given}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`;
  }
  if (!process.stdin.isTTY || !container.canPrompt) {
    return undefined;
  }

  const candidates: AiProviderId[] = availableProviderIds().filter((providerId) =>
    requiresApiKey(providerId),
  );
  process.stderr.write('어느 프로바이더의 API 키입니까?\n');
  candidates.forEach((providerId, index) => {
    process.stderr.write(`  ${index + 1}. ${providerId}\n`);
  });
  const answer: string = await askLine('번호 또는 이름: ');
  const byIndex: AiProviderId | undefined = candidates[Number(answer) - 1];

  return byIndex ?? (candidates.includes(answer as AiProviderId) ? answer : undefined);
}

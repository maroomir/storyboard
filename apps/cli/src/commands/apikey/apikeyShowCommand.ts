import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { availableProviderIds } from '@/adapters/availableProviders';
import { success } from '@/commands/outcomes';
import type { OAuthConnection } from '@storyboard/story-ai';
import { getProviderTransport, requiresApiKey, type AiProviderId } from '@storyboard/story-model';

export class ApikeyShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'apikey show',
    group: '시작하기',
    usage: 'apikey show',
    summary: '어느 프로바이더의 API 키가 저장돼 있는지 보여 줍니다 (값은 보이지 않습니다)',
    examples: ['storyboard apikey show'],
    needsWorkspace: false,
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
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
  }
}

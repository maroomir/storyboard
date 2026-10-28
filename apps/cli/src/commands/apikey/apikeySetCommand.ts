import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { resolveApiKeyProvider } from '@/commands/apikey/apikeyProviders';
import { availableProviderIds } from '@/adapters/availableProviders';
import { failure, success } from '@/commands/outcomes';
import { askSecret, readStdin } from '@/commands/prompt';
import { extractErrorMessage, type AiProviderId } from '@storyboard/story-model';

export class ApikeySetCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'apikey set',
    group: '시작하기',
    usage: 'apikey set [<provider>]',
    summary:
      'API 키를 저장합니다. 터미널이면 프로바이더를 고르고 키를 가려진 입력으로 받아 바로 연결을 확인하고, 파이프면 stdin 에서 읽습니다 (빈 입력이면 삭제)',
    examples: [
      'storyboard apikey set',
      'storyboard apikey set claude',
      'echo "$OPENAI_API_KEY" | storyboard apikey set openai',
    ],
    needsWorkspace: false,
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const provider: string | undefined = await resolveApiKeyProvider(
      container,
      args.positionals[0],
    );

    if (
      typeof provider === 'string' &&
      !availableProviderIds().includes(provider as AiProviderId)
    ) {
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
  }
}

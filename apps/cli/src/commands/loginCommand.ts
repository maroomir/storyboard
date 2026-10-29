import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import {
  LoginDependencies,
  LoginFlowFactory,
  LoginProviderResolution,
  createChatGptProvider,
  defaultLoginDependencies,
  describeLoginFailure,
  loginFlows,
  resolveLoginProvider,
} from '@/commands/loginProviders';
import { ChatGptLoginFlow } from '@storyboard/story-ai';
import {
  extractErrorMessage,
  getProviderDisplayName,
  type AiProviderId,
} from '@storyboard/story-model';
import type { CliContainer } from '@/container';
import { failure, success } from '@/commands/outcomes';

export class LoginCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'login',
    group: '시작하기',
    usage: 'login <provider>',
    summary:
      'API 키 대신 로그인으로 연결하는 프로바이더에 로그인합니다. 브라우저를 열고(열 수 없으면 주소를 출력), 로그인이 끝나면 세션을 ~/.storyboard/secrets.json 에 저장합니다',
    needsWorkspace: false,
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const resolved: LoginProviderResolution = resolveLoginProvider(args.positionals[0]);

    if ('problem' in resolved) {
      return failure(resolved.problem);
    }

    return this.signIn(container, resolved.providerId);
  }

  public async signIn(
    container: CliContainer,
    providerId: AiProviderId,
    deps: LoginDependencies = defaultLoginDependencies,
  ): Promise<CommandOutcome> {
    const createFlow: LoginFlowFactory | undefined = loginFlows[providerId];

    if (createFlow === undefined) {
      return failure(`${providerId} 는 로그인으로 연결하는 프로바이더가 아닙니다.`);
    }

    const displayName: string = getProviderDisplayName(providerId);
    const flow: ChatGptLoginFlow = createFlow({
      secretStore: container.secretStore,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
      ...(deps.preferredPort === undefined ? {} : { preferredPort: deps.preferredPort }),
    });
    let signedIn: { readonly accountLabel: string | undefined };

    try {
      signedIn = await flow.login({
        openBrowser: deps.openBrowser,
        onAuthorizationUrl: (url, wasOpened) => {
          process.stderr.write(
            [
              wasOpened
                ? `브라우저에서 ${displayName} 로그인을 마치세요. 창이 열리지 않았으면 아래 주소를 직접 여세요.`
                : `브라우저를 열 수 없습니다. 아래 주소를 브라우저에서 열어 ${displayName} 로그인을 마치세요.`,
              '다른 기계의 브라우저라면 이 주소의 포트를 이 기계로 포워딩해야 돌아올 수 있습니다.',
              '',
              `  ${url}`,
              '',
              '',
            ].join('\n'),
          );
        },
      });
    } catch (error) {
      return failure(describeLoginFailure(error));
    }

    const account: string =
      signedIn.accountLabel === undefined ? '' : ` (${signedIn.accountLabel})`;
    const saved: string = `${providerId} 에 로그인했습니다${account}: ${container.homePaths.secretsFile}`;

    try {
      await (
        await createChatGptProvider(container.configBridge, container.secretStore, deps.fetch)
      ).checkConnection();
      return success(`${saved}\n연결을 확인했습니다.`, {
        providerId,
        accountLabel: signedIn.accountLabel ?? null,
        verified: true,
      });
    } catch (error) {
      const reason: string = extractErrorMessage(error);
      return success(`${saved}\n다만 연결 확인에 실패했습니다: ${reason}`, {
        providerId,
        accountLabel: signedIn.accountLabel ?? null,
        verified: false,
      });
    }
  }
}

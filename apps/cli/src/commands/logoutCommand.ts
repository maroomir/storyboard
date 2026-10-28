import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import {
  LoginDependencies,
  LoginFlowFactory,
  LoginProviderResolution,
  loginFlows,
  resolveLoginProvider,
} from '@/commands/loginProviders';
import type { ChatGptLogoutResult } from '@storyboard/story-ai';
import type { AiProviderId } from '@storyboard/story-model';
import type { CliContainer } from '@/container';
import { failure, success } from '@/commands/outcomes';

export class LogoutCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'logout',
    group: '시작하기',
    usage: 'logout <provider>',
    summary: '로그인으로 연결한 프로바이더의 세션을 끝내고 저장된 로그인 정보를 지웁니다',
    needsWorkspace: false,
  };

  public async execute({ container, args }: CommandContext): Promise<CommandOutcome> {
    const resolved: LoginProviderResolution = resolveLoginProvider(args.positionals[0]);

    if ('problem' in resolved) {
      return failure(resolved.problem);
    }

    return this.signOut(container, resolved.providerId);
  }

  public async signOut(
    container: CliContainer,
    providerId: AiProviderId,
    deps: Pick<LoginDependencies, 'fetch'> = {},
  ): Promise<CommandOutcome> {
    const createFlow: LoginFlowFactory | undefined = loginFlows[providerId];

    if (createFlow === undefined) {
      return failure(`${providerId} 는 로그인으로 연결하는 프로바이더가 아닙니다.`);
    }

    const logout: ChatGptLogoutResult = await createFlow({
      secretStore: container.secretStore,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    }).logout();

    if (!logout.wasConnected) {
      return success(`${providerId} 에 로그인돼 있지 않았습니다.`, logout);
    }

    return success(
      logout.isRevoked
        ? `${providerId} 에서 로그아웃했습니다.`
        : `${providerId} 의 로그인 정보를 지웠습니다. 서버 쪽 세션 종료는 확인하지 못했으니 제공자의 계정 설정에서 앱 연결을 확인하세요.`,
      logout,
    );
  }
}

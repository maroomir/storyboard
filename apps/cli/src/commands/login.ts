import {
  ChatGptOAuthError,
  ChatGptProvider,
  loginChatGpt,
  logoutChatGpt,
  type ChatGptLogoutResult,
  type FetchLike,
  type SecretStore,
} from '@storyboard/story-ai';
import {
  extractErrorMessage,
  getProviderDisplayName,
  requiresApiKey,
  type AiProviderId,
} from '@storyboard/story-model';

import { availableProviderIds } from '@/adapters/availableProviders';
import { openBrowser } from '@/adapters/openBrowser';
import type { CliContainer } from '@/container';

import type { CommandContext, CommandOutcome } from './outcome';

interface LoginFlow {
  readonly login: (
    deps: Parameters<typeof loginChatGpt>[0],
  ) => Promise<{ readonly accountLabel: string | undefined }>;
  readonly logout: (deps: {
    readonly secretStore: SecretStore;
    readonly fetch?: FetchLike;
  }) => Promise<{ readonly wasConnected: boolean; readonly isRevoked: boolean }>;
}

const loginFlows: Partial<Record<AiProviderId, LoginFlow>> = {
  chatgpt: { login: loginChatGpt, logout: logoutChatGpt },
};

export interface LoginDependencies {
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly preferredPort?: number;
}

const defaultLoginDependencies: LoginDependencies = { openBrowser };

export async function createChatGptProvider(
  container: CliContainer,
  fetchImpl?: FetchLike,
): Promise<ChatGptProvider> {
  const { configBridge, secretStore } = container;

  return new ChatGptProvider({
    model: configBridge.getProviderConfig('chatgpt').model,
    connection: await secretStore.getOAuthConnection('chatgpt'),
    saveConnection: (connection) => secretStore.setOAuthConnection('chatgpt', connection),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}

function loginProviderIds(): AiProviderId[] {
  return availableProviderIds().filter((providerId) => loginFlows[providerId] !== undefined);
}

type LoginProviderResolution = { readonly providerId: AiProviderId } | { readonly problem: string };

function resolveLoginProvider(given: string | undefined): LoginProviderResolution {
  const candidates: AiProviderId[] = loginProviderIds();

  if (given === undefined) {
    return {
      problem:
        candidates.length === 0
          ? '로그인으로 연결하는 프로바이더가 없습니다.'
          : `프로바이더를 지정해 주세요: ${candidates.join(', ')}`,
    };
  }

  if (!availableProviderIds().includes(given as AiProviderId)) {
    return { problem: `모르는 프로바이더입니다: ${given}` };
  }

  const providerId: AiProviderId = given as AiProviderId;

  if (loginFlows[providerId] === undefined) {
    return {
      problem: requiresApiKey(providerId)
        ? `${providerId} 는 API 키로 연결합니다: storyboard apikey set ${providerId}`
        : `${providerId} 는 로그인이 필요 없는 프로바이더입니다.`,
    };
  }

  return { providerId };
}

function describeLoginFailure(error: unknown): string {
  if (error instanceof ChatGptOAuthError) {
    return error.message;
  }

  const detail: string = extractErrorMessage(error);
  return `로그인을 마치지 못했습니다: ${detail}`;
}

export async function signIn(
  container: CliContainer,
  providerId: AiProviderId,
  deps: LoginDependencies = defaultLoginDependencies,
): Promise<CommandOutcome> {
  const flow: LoginFlow | undefined = loginFlows[providerId];

  if (flow === undefined) {
    return { ok: false, message: `${providerId} 는 로그인으로 연결하는 프로바이더가 아닙니다.` };
  }

  const displayName: string = getProviderDisplayName(providerId);
  let signedIn: { readonly accountLabel: string | undefined };

  try {
    signedIn = await flow.login({
      secretStore: container.secretStore,
      openBrowser: deps.openBrowser,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
      ...(deps.preferredPort === undefined ? {} : { preferredPort: deps.preferredPort }),
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
    return { ok: false, message: describeLoginFailure(error) };
  }

  const account: string = signedIn.accountLabel === undefined ? '' : ` (${signedIn.accountLabel})`;
  const saved: string = `${providerId} 에 로그인했습니다${account}: ${container.homePaths.secretsFile}`;

  try {
    await (await createChatGptProvider(container, deps.fetch)).checkConnection();
    return {
      ok: true,
      message: `${saved}\n연결을 확인했습니다.`,
      data: { providerId, accountLabel: signedIn.accountLabel ?? null, verified: true },
    };
  } catch (error) {
    const reason: string = extractErrorMessage(error);
    return {
      ok: true,
      message: `${saved}\n다만 연결 확인에 실패했습니다: ${reason}`,
      data: { providerId, accountLabel: signedIn.accountLabel ?? null, verified: false },
    };
  }
}

export async function runLogin({ container, args }: CommandContext): Promise<CommandOutcome> {
  const resolved: LoginProviderResolution = resolveLoginProvider(args.positionals[0]);

  if ('problem' in resolved) {
    return { ok: false, message: resolved.problem };
  }

  return signIn(container, resolved.providerId);
}

export async function signOut(
  container: CliContainer,
  providerId: AiProviderId,
  deps: Pick<LoginDependencies, 'fetch'> = {},
): Promise<CommandOutcome> {
  const flow: LoginFlow | undefined = loginFlows[providerId];

  if (flow === undefined) {
    return { ok: false, message: `${providerId} 는 로그인으로 연결하는 프로바이더가 아닙니다.` };
  }

  const logout: ChatGptLogoutResult = await flow.logout({
    secretStore: container.secretStore,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  });

  if (!logout.wasConnected) {
    return { ok: true, message: `${providerId} 에 로그인돼 있지 않았습니다.`, data: logout };
  }

  return {
    ok: true,
    message: logout.isRevoked
      ? `${providerId} 에서 로그아웃했습니다.`
      : `${providerId} 의 로그인 정보를 지웠습니다. 서버 쪽 세션 종료는 확인하지 못했으니 제공자의 계정 설정에서 앱 연결을 확인하세요.`,
    data: logout,
  };
}

export async function runLogout({ container, args }: CommandContext): Promise<CommandOutcome> {
  const resolved: LoginProviderResolution = resolveLoginProvider(args.positionals[0]);

  if ('problem' in resolved) {
    return { ok: false, message: resolved.problem };
  }

  return signOut(container, resolved.providerId);
}

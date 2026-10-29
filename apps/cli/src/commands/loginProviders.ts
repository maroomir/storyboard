import {
  ChatGptLoginFlow,
  ChatGptOAuthError,
  ChatGptProvider,
  type ChatGptLoginFlowDependencies,
  type ConfigBridge,
  type FetchLike,
  type SecretStore,
} from '@storyboard/story-ai';
import { extractErrorMessage, requiresApiKey, type AiProviderId } from '@storyboard/story-model';
import { availableProviderIds } from '@/adapters/availableProviders';
import { openBrowser } from '@/adapters/openBrowser';

export type LoginFlowFactory = (deps: ChatGptLoginFlowDependencies) => ChatGptLoginFlow;

export const loginFlows: Partial<Record<AiProviderId, LoginFlowFactory>> = {
  chatgpt: (deps: ChatGptLoginFlowDependencies): ChatGptLoginFlow => new ChatGptLoginFlow(deps),
};

export interface LoginDependencies {
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly preferredPort?: number;
}

export const defaultLoginDependencies: LoginDependencies = { openBrowser };

export async function createChatGptProvider(
  configBridge: ConfigBridge,
  secretStore: SecretStore,
  fetchImpl?: FetchLike,
): Promise<ChatGptProvider> {
  return new ChatGptProvider({
    model: configBridge.getProviderConfig('chatgpt').model,
    connection: await secretStore.getOAuthConnection('chatgpt'),
    saveConnection: (connection) => secretStore.setOAuthConnection('chatgpt', connection),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}

export function loginProviderIds(): AiProviderId[] {
  return availableProviderIds().filter((providerId) => loginFlows[providerId] !== undefined);
}

export type LoginProviderResolution =
  | { readonly providerId: AiProviderId }
  | { readonly problem: string };

export function resolveLoginProvider(given: string | undefined): LoginProviderResolution {
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

export function describeLoginFailure(error: unknown): string {
  if (error instanceof ChatGptOAuthError) {
    return error.message;
  }

  const detail: string = extractErrorMessage(error);
  return `로그인을 마치지 못했습니다: ${detail}`;
}

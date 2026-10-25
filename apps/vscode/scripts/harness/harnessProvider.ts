import { ClaudeProvider, GoogleProvider, OpenAiProvider, SecretStore } from '@storyboard/story-ai';
import { getDefaultModelId, type AiProvider, type AiProviderId } from '@storyboard/story-model';
import { createFileSecretStorage, resolveStoryboardHomePaths } from '@storyboard/story-config';

const harnessProviderIds = ['claude', 'openai', 'google'] as const;

export type HarnessProviderId = (typeof harnessProviderIds)[number];

export function resolveHarnessProviderId(configured: string | undefined): HarnessProviderId {
  if (configured === undefined) {
    return 'claude';
  }

  if (!(harnessProviderIds as readonly string[]).includes(configured)) {
    throw new Error(
      `하네스가 쓸 수 없는 프로바이더입니다: ${configured}\n쓸 수 있는 값: ${harnessProviderIds.join(', ')}`,
    );
  }

  return configured as HarnessProviderId;
}

export function defaultHarnessModel(providerId: HarnessProviderId): string {
  const model = getDefaultModelId(providerId);

  if (model === undefined) {
    throw new Error(`${providerId} 기본 모델이 카탈로그에 없습니다.`);
  }

  return model;
}

export async function createHarnessProvider(
  providerId: HarnessProviderId,
  model: string,
): Promise<AiProvider> {
  const secretStore = new SecretStore(
    createFileSecretStorage(resolveStoryboardHomePaths(process.env).secretsFile),
  );
  const apiKey = await secretStore.getApiKey(providerId as AiProviderId);

  if (apiKey === undefined) {
    throw new Error(
      `${providerId} API 키가 없습니다. storyboard apikey set ${providerId} 로 저장한 뒤 다시 실행하세요.`,
    );
  }

  switch (providerId) {
    case 'claude':
      return new ClaudeProvider({ apiKey, model });
    case 'openai':
      return new OpenAiProvider({ apiKey, model });
    case 'google':
      return new GoogleProvider({ apiKey, model });
  }
}

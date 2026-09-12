import {
  ClaudeProvider,
  GoogleProvider,
  OpenAiProvider,
  SecretStore,
  getDefaultModelId,
  type AiProvider,
  type AiProviderId,
} from '@storyboard/story-ai';
import { createFileSecretStorage, resolveStoryboardHomePaths } from '@storyboard/story-config';

// NOTE: 하네스는 앱이 아니라 진단 스크립트라 컨테이너를 세우지 않는다. 대신 두 앱이 쓰는 같은
// 0600 시크릿 파일에서 키를 읽어 프로바이더 하나만 만든다. 키는 로그에 남기지 않는다.
// 구독 CLI 경로는 두지 않는다 — 스크립트가 연달아 부르는 것은 각 제공자가 API 키로 하라고
// 안내하는 프로그램적 호출이고, 진단 목적이라는 사실이 호출의 모양을 바꾸지 않는다.
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

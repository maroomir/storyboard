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

import { createClaudeCodeHarnessProvider } from './claudeCodeHarnessProvider';

// NOTE: 하네스는 앱이 아니라 진단 스크립트라 컨테이너를 세우지 않는다. 대신 두 앱이 쓰는 같은
// 0600 시크릿 파일에서 키를 읽어 프로바이더 하나만 만든다. 키는 로그에 남기지 않는다.
// `claude-code` 는 제품에 없는 진단 전용 경로다 — 구독 CLI 를 개인 계정으로 부르므로 키가 필요 없고,
// 이 경로로 잰 값은 모델 프로필에 기록하지 않는다.
const harnessProviderIds = ['claude', 'openai', 'google', 'claude-code'] as const;

const claudeCodeDefaultModel = 'sonnet';
const claudeCodeTimeoutMs = 600_000;

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
  if (providerId === 'claude-code') {
    return claudeCodeDefaultModel;
  }

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
  if (providerId === 'claude-code') {
    return createClaudeCodeHarnessProvider(model, claudeCodeTimeoutMs);
  }

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

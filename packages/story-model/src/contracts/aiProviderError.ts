import { type AiProviderId } from './aiTypes';

export type AiProviderErrorCode =
  | 'missing-provider'
  | 'missing-api-key'
  | 'missing-model'
  | 'connection-failed'
  | 'generation-failed'
  | 'provider-not-enabled'
  | 'risk-not-acknowledged'
  | 'cli-not-found'
  | 'cli-not-logged-in'
  | 'cli-usage-limit'
  | 'cli-timeout'
  // 브라우저 로그인 경로: 세션이 없거나 갱신이 거부됐다 / 구독 한도에 닿았다.
  | 'login-required'
  | 'usage-limit';

export class AiProviderError extends Error {
  public constructor(
    public readonly code: AiProviderErrorCode,
    public readonly providerId: AiProviderId,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

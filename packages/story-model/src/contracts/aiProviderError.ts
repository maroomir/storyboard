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
  | 'cli-timeout';

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

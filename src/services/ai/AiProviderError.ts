import { type AiConnectionFailureReason, type AiProviderId } from './types';

export type AiProviderErrorCode =
  | 'provider-not-registered'
  | 'missing-api-key'
  | 'missing-model'
  | 'connection-failed'
  | 'generation-failed';

export class AiProviderError extends Error {
  public readonly connectionReason?: AiConnectionFailureReason;

  public constructor(
    public readonly code: AiProviderErrorCode,
    public readonly providerId: AiProviderId,
    message: string,
    public readonly cause?: unknown,
    options?: { readonly connectionReason?: AiConnectionFailureReason },
  ) {
    super(message);
    this.name = 'AiProviderError';
    this.connectionReason = options?.connectionReason;
  }
}

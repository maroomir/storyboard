import { z } from 'zod';

import { providerIdSchema, type ProviderId } from './atoms';

export interface SecretsWriteApiKeyRequestPayload {
  providerId: ProviderId;
  apiKey: string;
}

export const secretsWriteApiKeyRequestPayloadSchema: z.ZodType<SecretsWriteApiKeyRequestPayload> =
  z.object({
    providerId: providerIdSchema,
    apiKey: z.string().min(1),
  });

export interface SecretsWriteApiKeyResponsePayload {
  hasApiKey: true;
}

export const secretsWriteApiKeyResponsePayloadSchema: z.ZodType<SecretsWriteApiKeyResponsePayload> =
  z.object({
    hasApiKey: z.literal(true),
  });

export interface SecretsDeleteApiKeyRequestPayload {
  providerId: ProviderId;
}

export const secretsDeleteApiKeyRequestPayloadSchema: z.ZodType<SecretsDeleteApiKeyRequestPayload> =
  z.object({
    providerId: providerIdSchema,
  });

export interface SecretsDeleteApiKeyResponsePayload {
  hasApiKey: false;
}

export const secretsDeleteApiKeyResponsePayloadSchema: z.ZodType<SecretsDeleteApiKeyResponsePayload> =
  z.object({
    hasApiKey: z.literal(false),
  });

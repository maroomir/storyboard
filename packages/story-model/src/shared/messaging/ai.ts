import { z } from 'zod';

import { aiTaskNameSchema, providerIdSchema, requestIdSchema, type ProviderId } from '#model/shared/messaging/atoms';
import type { AiMessage, AiProviderStatus, AiTaskName, AiUsage } from '#model/contracts/aiTypes';

const aiMessageSchema: z.ZodType<AiMessage> = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1),
});

export interface AiProvidersListRequestPayload {
  [key: string]: never;
}

export const aiProvidersListRequestPayloadSchema: z.ZodType<AiProvidersListRequestPayload> =
  z.object({});

export interface AiProvidersCheckConnectionRequestPayload {
  providerId: ProviderId;
}

export const aiProvidersCheckConnectionRequestPayloadSchema: z.ZodType<AiProvidersCheckConnectionRequestPayload> =
  z.object({
    providerId: providerIdSchema,
  });

export interface AiGenerateRequestPayload {
  providerId: ProviderId;
  taskName: AiTaskName;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
}

export const aiGenerateRequestPayloadSchema: z.ZodType<AiGenerateRequestPayload> = z.object({
  providerId: providerIdSchema,
  taskName: aiTaskNameSchema,
  messages: z.array(aiMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});
export const aiGenerateStreamRequestPayloadSchema: z.ZodType<AiGenerateRequestPayload> =
  aiGenerateRequestPayloadSchema;

export const aiProviderStatusSchema: z.ZodType<AiProviderStatus> = z.object({
  providerId: providerIdSchema,
  displayName: z.string().min(1),
  model: z.string().optional(),
  hasApiKey: z.boolean(),
  isAvailable: z.boolean(),
});

export interface AiProvidersListResponsePayload {
  providers: AiProviderStatus[];
}

export const aiProvidersListResponsePayloadSchema: z.ZodType<AiProvidersListResponsePayload> =
  z.object({
    providers: z.array(aiProviderStatusSchema),
  });

export interface AiProvidersCheckConnectionResponsePayload {
  ok: boolean;
}

export const aiProvidersCheckConnectionResponsePayloadSchema: z.ZodType<AiProvidersCheckConnectionResponsePayload> =
  z.object({
    ok: z.boolean(),
  });

const aiUsageSchema: z.ZodType<AiUsage> = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadInputTokens: z.number().nonnegative().optional(),
  cacheCreationInputTokens: z.number().nonnegative().optional(),
});

export interface AiGenerateResponsePayload {
  text: string;
  providerId: ProviderId;
  model?: string;
  usage?: AiUsage;
  costUsd?: number;
}

export const aiGenerateResponsePayloadSchema: z.ZodType<AiGenerateResponsePayload> = z.object({
  text: z.string(),
  providerId: providerIdSchema,
  model: z.string().optional(),
  usage: aiUsageSchema.optional(),
  costUsd: z.number().optional(),
});
export const aiGenerateStreamResponsePayloadSchema: z.ZodType<AiGenerateResponsePayload> =
  aiGenerateResponsePayloadSchema;
export interface AiGenerateStreamChunkEventPayload {
  requestId: string;
  delta: string;
}

export const aiGenerateStreamChunkEventPayloadSchema: z.ZodType<AiGenerateStreamChunkEventPayload> =
  z.object({
    requestId: requestIdSchema,
    delta: z.string(),
  });

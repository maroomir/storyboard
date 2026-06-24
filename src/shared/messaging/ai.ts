import { z } from "zod"

import { aiTaskNameSchema, providerIdSchema, requestIdSchema } from "./atoms"

const aiMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1)
})

export const aiProvidersListRequestPayloadSchema = z.object({})

export const aiProvidersCheckConnectionRequestPayloadSchema = z.object({
  providerId: providerIdSchema
})

export const aiGenerateRequestPayloadSchema = z.object({
  providerId: providerIdSchema,
  taskName: aiTaskNameSchema,
  messages: z.array(aiMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional()
})
export const aiGenerateStreamRequestPayloadSchema = aiGenerateRequestPayloadSchema

export const aiProviderStatusSchema = z.object({
  providerId: providerIdSchema,
  displayName: z.string().min(1),
  model: z.string().optional(),
  hasApiKey: z.boolean(),
  isAvailable: z.boolean()
})

export const aiProvidersListResponsePayloadSchema = z.object({
  providers: z.array(aiProviderStatusSchema)
})

export const aiProvidersCheckConnectionResponsePayloadSchema = z.object({
  ok: z.boolean(),
  reason: z.literal("not-installed").optional()
})

const aiUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadInputTokens: z.number().nonnegative().optional(),
  cacheCreationInputTokens: z.number().nonnegative().optional()
})

export const aiGenerateResponsePayloadSchema = z.object({
  text: z.string(),
  providerId: providerIdSchema,
  model: z.string().optional(),
  usage: aiUsageSchema.optional(),
  costUsd: z.number().optional()
})
export const aiGenerateStreamResponsePayloadSchema = aiGenerateResponsePayloadSchema
export const aiGenerateStreamChunkEventPayloadSchema = z.object({
  requestId: requestIdSchema,
  delta: z.string()
})

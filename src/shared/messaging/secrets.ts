import { z } from "zod"

import { providerIdSchema } from "./atoms"

export const secretsWriteApiKeyRequestPayloadSchema = z.object({
  providerId: providerIdSchema,
  apiKey: z.string().min(1)
})

export const secretsWriteApiKeyResponsePayloadSchema = z.object({
  hasApiKey: z.literal(true)
})

export const secretsDeleteApiKeyRequestPayloadSchema = z.object({
  providerId: providerIdSchema
})

export const secretsDeleteApiKeyResponsePayloadSchema = z.object({
  hasApiKey: z.literal(false)
})

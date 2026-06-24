import { z } from "zod"

import { cardSchema, cardTypes, characterRoles } from "../card"
import { uriStringSchema } from "./atoms"

export const cardsListRequestPayloadSchema = z.object({
  type: z.enum(cardTypes).optional()
})

export const cardsReadRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const cardsWriteRequestPayloadSchema = z.object({
  uri: uriStringSchema,
  card: cardSchema,
  rawText: z.string().optional()
})

export const cardsWriteRawRequestPayloadSchema = z.object({
  uri: uriStringSchema,
  rawText: z.string()
})

export const cardsCreatePlaceholderRequestPayloadSchema = z.object({
  type: z.enum(cardTypes),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1)
})

export const cardsResolveImageUriRequestPayloadSchema = z.object({
  cardUri: uriStringSchema,
  relativePath: z.string().trim().min(1)
})

export const cardsOpenRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const cardsDeleteRequestPayloadSchema = z.object({
  uri: uriStringSchema
})

export const cardSummarySchema = z.object({
  type: z.enum(cardTypes),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  uri: uriStringSchema
})

export const sidebarCardSummarySchema = z.object({
  type: z.enum(cardTypes),
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  uri: uriStringSchema,
  description: z.string().optional(),
  error: z.string().optional(),
  role: z.enum(characterRoles).optional()
})

export type SidebarCardSummary = z.infer<typeof sidebarCardSummarySchema>

export const sidebarCardsInitialDataSchema = z.object({
  type: z.enum(["character", "background"] as const),
  title: z.string().trim().min(1),
  cards: z.array(sidebarCardSummarySchema),
  isStoryboardProject: z.boolean(),
  usage: z.unknown()
})

export const cardsListResponsePayloadSchema = z.object({
  cards: z.array(cardSummarySchema)
})

export const cardsReadResponsePayloadSchema = z.object({
  card: cardSchema
})

export const cardsWriteResponsePayloadSchema = z.object({
  card: cardSchema
})

export const cardsWriteRawResponsePayloadSchema = z.object({
  card: cardSchema,
  rawText: z.string()
})

export const cardsCreatePlaceholderResponsePayloadSchema = z.object({
  card: cardSchema,
  uri: uriStringSchema
})

export const cardsResolveImageUriResponsePayloadSchema = z.object({
  uri: uriStringSchema
})

export const cardsOpenResponsePayloadSchema = z.object({})
export const cardsDeleteResponsePayloadSchema = z.object({})

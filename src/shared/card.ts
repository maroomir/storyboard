import { z } from "zod"

export const cardIdPattern = /^[a-z0-9][a-z0-9-]*$/

export const cardTypes = ["character", "location", "temporal", "social"] as const

export const characterRoles = ["main", "supporting", "extra"] as const
export type CharacterRole = (typeof characterRoles)[number]

export function isCharacterRole(value: string | undefined): value is CharacterRole {
  return value === "main" || value === "supporting" || value === "extra"
}

export const characterRoleSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) {
      return undefined
    }

    if (typeof value !== "string") {
      return "extra"
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return undefined
    }

    return isCharacterRole(trimmed) ? trimmed : "extra"
  },
  z.enum(characterRoles).optional()
)

const cardIdSchema = z.string().regex(cardIdPattern, {
  message: "Card id must use lowercase letters, numbers, and hyphens."
})

const stringListSchema = z.array(z.string())

export const characterCardSchema = z.object({
  type: z.literal("character"),
  id: cardIdSchema,
  name: z.string().trim().min(1),
  role: characterRoleSchema,
  aliases: stringListSchema.optional(),
  tags: stringListSchema.optional(),
  traits: stringListSchema.optional(),
  description: z.string().optional(),
  voice: z.string().optional(),
  recentDialogues: stringListSchema.optional()
})

const backgroundBaseFields = {
  id: cardIdSchema,
  name: z.string().trim().min(1),
  description: z.string().default(""),
  characterIds: stringListSchema.default([]),
  tags: stringListSchema.default([])
}

export const locationBackgroundSchema = z.object({
  type: z.literal("location"),
  ...backgroundBaseFields
})

export const temporalBackgroundSchema = z.object({
  type: z.literal("temporal"),
  ...backgroundBaseFields
})

export const socialBackgroundSchema = z.object({
  type: z.literal("social"),
  ...backgroundBaseFields
})

export const backgroundCardSchema = z.discriminatedUnion("type", [
  locationBackgroundSchema,
  temporalBackgroundSchema,
  socialBackgroundSchema
])

export const cardSchema = z.discriminatedUnion("type", [
  characterCardSchema,
  locationBackgroundSchema,
  temporalBackgroundSchema,
  socialBackgroundSchema
])

export type CardType = (typeof cardTypes)[number]
export type CharacterCard = z.infer<typeof characterCardSchema>
export type LocationBackgroundCard = z.infer<typeof locationBackgroundSchema>
export type TemporalBackgroundCard = z.infer<typeof temporalBackgroundSchema>
export type SocialBackgroundCard = z.infer<typeof socialBackgroundSchema>
export type BackgroundCard = LocationBackgroundCard | TemporalBackgroundCard | SocialBackgroundCard
export type StoryboardCard = z.infer<typeof cardSchema>

export function isCardType(value: string): value is CardType {
  return cardTypes.includes(value as CardType)
}

export function isBackgroundCard(card: StoryboardCard): card is BackgroundCard {
  return card.type === "location" || card.type === "temporal" || card.type === "social"
}

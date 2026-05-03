import { z } from "zod"

export const cardIdPattern = /^[a-z0-9][a-z0-9-]*$/

export const cardTypes = ["character", "background"] as const

const cardIdSchema = z.string().regex(cardIdPattern, {
  message: "Card id must use lowercase letters, numbers, and hyphens."
})

const stringListSchema = z.array(z.string())
const cardAttributeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const characterRelationSchema = z.object({
  target: cardIdSchema,
  type: z.string().trim().min(1)
})

export const characterArcSchema = z.object({
  stage: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  sceneRef: z.string().trim().min(1).optional()
})

export const characterCardSchema = z.object({
  type: z.literal("character"),
  id: cardIdSchema,
  name: z.string().trim().min(1),
  profile: z.string().trim().min(1).optional(),
  role: z.string().trim().min(1).optional(),
  attributes: z.record(z.string(), cardAttributeValueSchema).optional(),
  tags: stringListSchema.optional(),
  traits: stringListSchema.optional(),
  description: z.string().optional(),
  relations: z.array(characterRelationSchema).optional(),
  arc: z.array(characterArcSchema).optional(),
  recentDialogues: stringListSchema.optional()
})

export const backgroundCardSchema = z.object({
  type: z.literal("background"),
  id: cardIdSchema,
  name: z.string().trim().min(1),
  concept: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  tags: stringListSchema.optional(),
  description: z.string().optional()
})

export const cardSchema = z.discriminatedUnion("type", [characterCardSchema, backgroundCardSchema])

export type CardType = (typeof cardTypes)[number]
export type CharacterRelation = z.infer<typeof characterRelationSchema>
export type CharacterArc = z.infer<typeof characterArcSchema>
export type CharacterCard = z.infer<typeof characterCardSchema>
export type BackgroundCard = z.infer<typeof backgroundCardSchema>
export type StoryboardCard = z.infer<typeof cardSchema>

export function isCardType(value: string): value is CardType {
  return cardTypes.includes(value as CardType)
}

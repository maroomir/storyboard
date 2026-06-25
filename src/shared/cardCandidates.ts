import { z } from "zod"

export const cardAttributeCandidateSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string().trim().min(1)
})

export const cardRelationCandidateSchema = z.object({
  target: z.string().trim().min(1),
  type: z.string().trim().min(1)
})

export const cardArcCandidateSchema = z.object({
  stage: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1),
  sceneRef: z.string().trim().min(1)
})

export const cardCandidateCharacterSchema = z.object({
  cardId: z.string().trim().min(1),
  attributes: z.array(cardAttributeCandidateSchema).default([]),
  relations: z.array(cardRelationCandidateSchema).default([]),
  arc: z.array(cardArcCandidateSchema).default([])
})

export const cardCandidateRecordSchema = z.object({
  sceneStem: z.string().trim().min(1),
  generatedAt: z.string().datetime(),
  characters: z.array(cardCandidateCharacterSchema)
})

export type CardAttributeCandidate = z.infer<typeof cardAttributeCandidateSchema>
export type CardRelationCandidate = z.infer<typeof cardRelationCandidateSchema>
export type CardArcCandidate = z.infer<typeof cardArcCandidateSchema>
export type CardCandidateCharacter = z.infer<typeof cardCandidateCharacterSchema>
export type CardCandidateRecord = z.infer<typeof cardCandidateRecordSchema>

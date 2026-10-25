import { z } from 'zod';

export interface CardAttributeCandidate {
  key: string;
  value: string;
}

const cardAttributeCandidateSchema: z.ZodType<CardAttributeCandidate> = z.object({
  key: z.string().trim().min(1),
  value: z.string().trim().min(1),
});

export interface CardRelationCandidate {
  target: string;
  type: string;
}

const cardRelationCandidateSchema: z.ZodType<CardRelationCandidate> = z.object({
  target: z.string().trim().min(1),
  type: z.string().trim().min(1),
});

export interface CardArcCandidate {
  summary: string;
  sceneRef: string;
  stage?: string;
}

const cardArcCandidateSchema: z.ZodType<CardArcCandidate> = z.object({
  stage: z.string().trim().min(1).optional(),
  summary: z.string().trim().min(1),
  sceneRef: z.string().trim().min(1),
});

export interface CardCandidateCharacter {
  cardId: string;
  attributes: CardAttributeCandidate[];
  relations: CardRelationCandidate[];
  arc: CardArcCandidate[];
}

const cardCandidateCharacterSchema: z.ZodType<CardCandidateCharacter> = z.object({
  cardId: z.string().trim().min(1),
  attributes: z.array(cardAttributeCandidateSchema).default([]),
  relations: z.array(cardRelationCandidateSchema).default([]),
  arc: z.array(cardArcCandidateSchema).default([]),
});

export interface CardCandidateRecord {
  sceneStem: string;
  generatedAt: string;
  characters: CardCandidateCharacter[];
}

export const cardCandidateRecordSchema: z.ZodType<CardCandidateRecord> = z.object({
  sceneStem: z.string().trim().min(1),
  generatedAt: z.string().datetime(),
  characters: z.array(cardCandidateCharacterSchema),
});

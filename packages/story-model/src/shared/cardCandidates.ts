import type { AttributeCandidate, RelationLink } from '#model/format/card';
import { z } from 'zod';

const cardAttributeCandidateSchema: z.ZodType<AttributeCandidate> = z.object({
  key: z.string().trim().min(1),
  value: z.string().trim().min(1),
});

const cardRelationCandidateSchema: z.ZodType<RelationLink> = z.object({
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
  attributes: AttributeCandidate[];
  relations: RelationLink[];
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

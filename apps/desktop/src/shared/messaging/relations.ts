import { z } from 'zod';

import { uriStringSchema } from './atoms';

export const relationsListRequestPayloadSchema = z.object({});

export const relationListItemRelationSchema = z.object({
  target: z.string().trim().min(1),
  type: z.string().trim().min(1),
});

export const relationListCharacterSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  uri: uriStringSchema,
  relations: z.array(relationListItemRelationSchema),
});

export const relationsListResponsePayloadSchema = z.object({
  characters: z.array(relationListCharacterSchema),
});

export type RelationListCharacter = z.infer<typeof relationListCharacterSchema>;

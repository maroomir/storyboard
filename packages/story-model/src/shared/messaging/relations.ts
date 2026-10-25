import { z } from 'zod';

import { uriStringSchema } from './atoms';

export interface RelationsListRequestPayload {
  [key: string]: never;
}

export const relationsListRequestPayloadSchema: z.ZodType<RelationsListRequestPayload> = z.object(
  {},
);

interface RelationListItemRelation {
  target: string;
  type: string;
}

const relationListItemRelationSchema: z.ZodType<RelationListItemRelation> = z.object({
  target: z.string().trim().min(1),
  type: z.string().trim().min(1),
});

export interface RelationListCharacter {
  id: string;
  name: string;
  uri: string;
  relations: RelationListItemRelation[];
  role?: string;
}

const relationListCharacterSchema: z.ZodType<RelationListCharacter> = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  uri: uriStringSchema,
  relations: z.array(relationListItemRelationSchema),
});

export interface RelationsListResponsePayload {
  characters: RelationListCharacter[];
}

export const relationsListResponsePayloadSchema: z.ZodType<RelationsListResponsePayload> = z.object(
  {
    characters: z.array(relationListCharacterSchema),
  },
);

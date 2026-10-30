import { z } from 'zod';

import { uriStringSchema } from '#model/shared/messaging/atoms';
import type { CharacterRole, RelationLink } from '#model/format/card';

export interface RelationsListRequestPayload {
  [key: string]: never;
}

export const relationsListRequestPayloadSchema: z.ZodType<RelationsListRequestPayload> = z.object(
  {},
);

const relationListItemRelationSchema: z.ZodType<RelationLink> = z.object({
  target: z.string().trim().min(1),
  type: z.string().trim().min(1),
});

export interface CharacterRosterEntry {
  readonly id: string;
  readonly name: string;
  readonly role?: CharacterRole;
}

export interface RelationListCharacter {
  id: string;
  name: string;
  uri: string;
  relations: RelationLink[];
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

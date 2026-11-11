import { z } from 'zod';

import {
  elementIdSchema,
  elementSlugSchema,
  headerTextListSchema,
  headerTextSchema,
} from '#model/element/elementId';
import type { ElementDefinition } from '#model/element/facet';

export type CharacterRole = 'main' | 'supporting' | 'extra';

export const characterRoles: readonly [CharacterRole, ...CharacterRole[]] = [
  'main',
  'supporting',
  'extra',
];

export function isCharacterRole(value: string | undefined): value is CharacterRole {
  return value === 'main' || value === 'supporting' || value === 'extra';
}

export type CharacterFacetId = 'traits' | 'catchphrases' | 'desire' | 'relation' | 'speech' | 'arc';

export const characterElement: ElementDefinition<CharacterFacetId> = {
  kind: 'character',
  sections: ['personality', 'voice', 'relations', 'arc', 'description', 'facts'],
  facets: [
    {
      id: 'traits',
      label: '성격',
      shape: 'list',
      kinds: ['character'],
      section: 'personality',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile', 'interview'],
    },
    {
      id: 'catchphrases',
      label: '입버릇',
      shape: 'list',
      kinds: ['character'],
      section: 'voice',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile', 'catchphraseLimit'],
    },
    {
      id: 'desire',
      label: '욕망',
      shape: 'list',
      kinds: ['character'],
      section: 'personality',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile', 'interview'],
    },
    {
      id: 'relation',
      label: '관계',
      shape: 'perTarget',
      kinds: ['character'],
      section: 'relations',
      key: 'forbidden',
      about: 'required',
      consumers: ['profile'],
    },
    {
      id: 'speech',
      label: '상대별 말투',
      shape: 'perTarget',
      kinds: ['character'],
      section: 'relations',
      key: 'forbidden',
      about: 'required',
      consumers: ['profile', 'interview', 'dialoguePolish'],
    },
    {
      id: 'arc',
      label: '변화',
      shape: 'scalar',
      kinds: ['character'],
      section: 'arc',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile'],
    },
  ],
};

export type CharacterAttributeKey = 'sex' | 'age' | 'job';

export const characterAttributeKeys: readonly CharacterAttributeKey[] = ['sex', 'age', 'job'];

export interface CharacterAttributes {
  readonly sex?: string;
  readonly age?: number | string;
  readonly job?: string;
}

export interface CharacterHeader {
  readonly id: string;
  readonly slug: string;
  readonly kind: 'character';
  readonly name: string;
  readonly role?: CharacterRole;
  readonly attributes?: CharacterAttributes;
  readonly aliases?: readonly string[];
}

const characterAttributesSchema: z.ZodType<CharacterAttributes> = z
  .object({
    sex: headerTextSchema.optional(),
    age: z.union([z.number().int().nonnegative(), headerTextSchema]).optional(),
    job: headerTextSchema.optional(),
  })
  .strict();

export const characterHeaderSchema: z.ZodType<CharacterHeader> = z
  .object({
    id: elementIdSchema,
    slug: elementSlugSchema,
    kind: z.literal('character'),
    name: headerTextSchema,
    role: z.enum(characterRoles).optional(),
    attributes: characterAttributesSchema.optional(),
    aliases: headerTextListSchema.optional(),
  })
  .strict();

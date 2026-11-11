import { z } from 'zod';

import {
  elementIdSchema,
  elementSlugSchema,
  headerTextListSchema,
  headerTextSchema,
} from '#model/element/elementId';
import type { ElementDefinition } from '#model/element/facet';

export type BackgroundFacetId = 'tags' | 'time' | 'weather' | 'senses' | 'layout' | 'rules';

export const backgroundElement: ElementDefinition<BackgroundFacetId> = {
  kind: 'background',
  sections: ['atmosphere', 'senses', 'layout', 'rules', 'description', 'facts'],
  facets: [
    {
      id: 'tags',
      label: '태그',
      shape: 'list',
      kinds: ['background'],
      section: 'atmosphere',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile'],
    },
    {
      id: 'time',
      label: '시간',
      shape: 'scalar',
      kinds: ['background'],
      section: 'atmosphere',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile'],
    },
    {
      id: 'weather',
      label: '날씨',
      shape: 'scalar',
      kinds: ['background'],
      section: 'atmosphere',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile'],
    },
    {
      id: 'senses',
      label: '감각',
      shape: 'list',
      kinds: ['background'],
      section: 'senses',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile', 'interview'],
    },
    {
      id: 'layout',
      label: '배치',
      shape: 'list',
      kinds: ['background'],
      section: 'layout',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile', 'interview'],
    },
    {
      id: 'rules',
      label: '규칙',
      shape: 'list',
      kinds: ['background'],
      section: 'rules',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['profile', 'interview'],
    },
  ],
};

export interface BackgroundHeader {
  readonly id: string;
  readonly slug: string;
  readonly kind: 'background';
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly within?: string;
}

export const backgroundHeaderSchema: z.ZodType<BackgroundHeader> = z
  .object({
    id: elementIdSchema,
    slug: elementSlugSchema,
    kind: z.literal('background'),
    name: headerTextSchema,
    aliases: headerTextListSchema.optional(),
    within: elementIdSchema.optional(),
  })
  .strict();

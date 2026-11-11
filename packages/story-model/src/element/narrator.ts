import { z } from 'zod';

import { elementIdSchema, elementSlugSchema, headerTextSchema } from '#model/element/elementId';
import type { ElementDefinition } from '#model/element/facet';

export type NarratorPerson = 'first' | 'second' | 'third';

export const narratorPersons: readonly [NarratorPerson, ...NarratorPerson[]] = [
  'first',
  'second',
  'third',
];

export type NarratorKnowledge = 'witnessed' | 'omniscient' | 'retrospective';

export const narratorKnowledges: readonly [NarratorKnowledge, ...NarratorKnowledge[]] = [
  'witnessed',
  'omniscient',
  'retrospective',
];

export type NarrativeTense = 'past' | 'present';

export const narrativeTenses: readonly [NarrativeTense, ...NarrativeTense[]] = ['past', 'present'];

export const narratorPersonLabels: Record<NarratorPerson, string> = {
  first: '1인칭',
  second: '2인칭',
  third: '3인칭',
};

export const narratorKnowledgeLabels: Record<NarratorKnowledge, string> = {
  witnessed: '목격 범위',
  omniscient: '전지',
  retrospective: '회고',
};

export const narrativeTenseLabels: Record<NarrativeTense, string> = {
  past: '과거형',
  present: '현재형',
};

export const narratorElement: ElementDefinition<never> = {
  kind: 'narrator',
  sections: ['voice', 'description', 'facts'],
  facets: [],
};

export interface NarratorHeader {
  readonly id: string;
  readonly slug: string;
  readonly kind: 'narrator';
  readonly name: string;
  readonly person: NarratorPerson;
  readonly knowledge: NarratorKnowledge;
  readonly tense?: NarrativeTense;
  readonly focal?: string;
}

export const narratorHeaderSchema: z.ZodType<NarratorHeader> = z
  .object({
    id: elementIdSchema,
    slug: elementSlugSchema,
    kind: z.literal('narrator'),
    name: headerTextSchema,
    person: z.enum(narratorPersons),
    knowledge: z.enum(narratorKnowledges),
    tense: z.enum(narrativeTenses).optional(),
    focal: elementIdSchema.optional(),
  })
  .strict();

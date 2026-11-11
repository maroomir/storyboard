import { z } from 'zod';

import { elementIdSchema, elementSlugSchema, headerTextSchema } from '#model/element/elementId';
import type { ElementDefinition } from '#model/element/facet';

export type SceneFacetId =
  | 'purpose'
  | 'conflict'
  | 'twist'
  | 'emotionalShift'
  | 'endState'
  | 'foreshadowing';

export const sceneElement: ElementDefinition<SceneFacetId> = {
  kind: 'scene',
  sections: ['design', 'foreshadowing'],
  facets: [
    {
      id: 'purpose',
      label: '목적',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'conflict',
      label: '갈등',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'twist',
      label: '반전',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'emotionalShift',
      label: '감정 변화',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'endState',
      label: '종료 지점',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'foreshadowing',
      label: '회수할 복선',
      shape: 'list',
      kinds: ['scene'],
      section: 'foreshadowing',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign', 'manuscriptAssembly'],
    },
  ],
};

const sceneNumberPrefixPattern: RegExp = /^\d{3}-/;

const allDigitsPattern: RegExp = /^\d+$/;

export function isSceneSlug(slug: string): boolean {
  return !allDigitsPattern.test(slug) && !sceneNumberPrefixPattern.test(slug);
}

export interface SceneHeader {
  readonly id: string;
  readonly slug: string;
  readonly kind: 'scene';
  readonly title: string;
  readonly cast?: readonly string[];
  readonly place?: string;
  readonly time?: string;
  readonly targetWordCount?: number;
}

export const sceneHeaderSchema: z.ZodType<SceneHeader> = z
  .object({
    id: elementIdSchema,
    slug: elementSlugSchema.refine(isSceneSlug, {
      message: '씬 slug 에는 번호를 붙이지 않습니다. 번호는 구조 순서에서 나옵니다.',
    }),
    kind: z.literal('scene'),
    title: headerTextSchema,
    cast: z.array(elementIdSchema).readonly().optional(),
    place: elementIdSchema.optional(),
    time: headerTextSchema.optional(),
    targetWordCount: z.number().int().positive().optional(),
  })
  .strict();

export interface Beat {
  readonly text: string;
  readonly cast?: readonly string[];
  readonly place?: string;
  readonly time?: string;
}

export const beatSchema: z.ZodType<Beat> = z
  .object({
    text: headerTextSchema,
    cast: z.array(elementIdSchema).readonly().optional(),
    place: elementIdSchema.optional(),
    time: headerTextSchema.optional(),
  })
  .strict();

import { z } from 'zod';

import { backgroundHeaderSchema, type BackgroundHeader } from '#model/element/background';
import { characterHeaderSchema, type CharacterHeader } from '#model/element/character';
import type { ElementKind } from '#model/element/elementKind';
import { narratorHeaderSchema, type NarratorHeader } from '#model/element/narrator';
import { sceneHeaderSchema, type SceneHeader } from '#model/element/scene';

export type ElementHeader = CharacterHeader | BackgroundHeader | NarratorHeader | SceneHeader;

export const elementHeaderSchemas: Record<ElementKind, z.ZodType<ElementHeader>> = {
  character: characterHeaderSchema,
  background: backgroundHeaderSchema,
  scene: sceneHeaderSchema,
  narrator: narratorHeaderSchema,
};

export function getElementDisplayName(header: ElementHeader): string {
  return header.kind === 'scene' ? header.title : header.name;
}

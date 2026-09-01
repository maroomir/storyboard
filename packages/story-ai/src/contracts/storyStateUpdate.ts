import { z } from 'zod';

import { hasForeignScript } from '@storyboard/story-format';

import { parseJsonObject } from './aiResponseParser';

export const storyStateUpdateSections = ['facts', 'relations', 'revealed', 'motifs'] as const;

export type StoryStateUpdateSection = (typeof storyStateUpdateSections)[number];

export interface StoryStateUpdateItem {
  readonly section: StoryStateUpdateSection;
  readonly text: string;
}

const sectionListSchema = z.array(z.unknown()).optional();
const maxItemsPerSection = 5;
const maxItemLength = 200;

function coerceSectionItems(
  raw: unknown,
  section: StoryStateUpdateSection,
): StoryStateUpdateItem[] {
  const parsed = sectionListSchema.safeParse(raw);
  if (!parsed.success || !parsed.data) {
    return [];
  }

  return parsed.data
    .flatMap((item) => (typeof item === 'string' ? [item.trim()] : []))
    .filter((text) => text.length > 0 && !hasForeignScript(text))
    .slice(0, maxItemsPerSection)
    .map((text) => ({ section, text: text.slice(0, maxItemLength) }));
}

export function coerceStoryStateUpdate(rawText: string): StoryStateUpdateItem[] {
  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    return [];
  }

  return storyStateUpdateSections.flatMap((section) =>
    coerceSectionItems(parsed[section], section),
  );
}

import { z } from 'zod';

import { hasForeignScript } from '#model/format/foreignScript';

import { parseJsonObject } from './aiResponseParser';

export const storyStateUpdateSections = ['facts', 'relations', 'revealed', 'motifs'] as const;

export type StoryStateUpdateSection = (typeof storyStateUpdateSections)[number];

export interface StoryStateUpdateItem {
  readonly section: StoryStateUpdateSection;
  readonly text: string;
  // 그 사실이 확립되는 자리에 있었거나 그것을 알게 된 인물의 이름. 없으면 그 씬의 모든 인물이다.
  readonly witnesses?: readonly string[];
}

const taggedItemSchema = z.object({
  text: z.string(),
  witnesses: z.array(z.unknown()).optional(),
});

function readTaggedItem(item: unknown): { text: string; witnesses?: string[] } | undefined {
  if (typeof item === 'string') {
    return { text: item.trim() };
  }

  const tagged = taggedItemSchema.safeParse(item);
  if (!tagged.success) {
    return undefined;
  }

  const witnesses = (tagged.data.witnesses ?? [])
    .flatMap((name) => (typeof name === 'string' ? [name.trim()] : []))
    .filter((name) => name.length > 0);

  return { text: tagged.data.text.trim(), ...(witnesses.length > 0 ? { witnesses } : {}) };
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
    .flatMap((item) => {
      const tagged = readTaggedItem(item);
      return tagged === undefined ? [] : [tagged];
    })
    .filter((item) => item.text.length > 0 && !hasForeignScript(item.text))
    .slice(0, maxItemsPerSection)
    .map((item) => ({
      section,
      text: item.text.slice(0, maxItemLength),
      ...(item.witnesses === undefined ? {} : { witnesses: item.witnesses }),
    }));
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

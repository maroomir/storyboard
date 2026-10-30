import { z } from 'zod';

import { hasForeignScript } from '#model/format/foreignScript';

import { parseJsonObject } from '#model/contracts/aiResponseParser';
import type { StoryStateSection } from '#model/format/storyState';

export const storyStateUpdateSections: readonly [StoryStateSection, ...StoryStateSection[]] = [
  'facts',
  'relations',
  'revealed',
  'motifs',
];

export interface StoryStateUpdateItem {
  readonly section: StoryStateSection;
  readonly text: string;
  readonly witnesses?: readonly string[];
}

interface TaggedItem {
  text: string;
  witnesses?: unknown[];
}

const taggedItemSchema: z.ZodType<TaggedItem> = z.object({
  text: z.string(),
  witnesses: z.array(z.unknown()).optional(),
});

function readTaggedItem(item: unknown): { text: string; witnesses?: string[] } | undefined {
  if (typeof item === 'string') {
    return { text: item.trim() };
  }

  const tagged: z.ZodSafeParseResult<TaggedItem> = taggedItemSchema.safeParse(item);
  if (!tagged.success) {
    return undefined;
  }

  const witnesses: string[] = (tagged.data.witnesses ?? [])
    .flatMap((name) => (typeof name === 'string' ? [name.trim()] : []))
    .filter((name) => name.length > 0);

  return { text: tagged.data.text.trim(), ...(witnesses.length > 0 ? { witnesses } : {}) };
}

type SectionList = unknown[] | undefined;

const sectionListSchema: z.ZodType<SectionList> = z.array(z.unknown()).optional();
const maxItemsPerSection: number = 5;
const maxItemLength: number = 200;

function coerceSectionItems(raw: unknown, section: StoryStateSection): StoryStateUpdateItem[] {
  const parsed: z.ZodSafeParseResult<unknown[] | undefined> = sectionListSchema.safeParse(raw);
  if (!parsed.success || !parsed.data) {
    return [];
  }

  return parsed.data
    .flatMap((item) => {
      const tagged: ReturnType<typeof readTaggedItem> = readTaggedItem(item);
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
  const parsed: Record<string, unknown> | null = parseJsonObject(rawText);
  if (!parsed) {
    return [];
  }

  return storyStateUpdateSections.flatMap((section) =>
    coerceSectionItems(parsed[section], section),
  );
}

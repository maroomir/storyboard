import { z } from 'zod';

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

// NOTE: 한국어 원고 생성에서 다른 문자 체계가 토막으로 새어 나오는 일이 있다(관측: 벵골·키릴).
// 원장은 이후 모든 씬 프롬프트로 퍼지므로, 오염된 항목은 받아들이지 않고 버린다.
const foreignScriptPattern =
  /[\u0400-\u04FF\u0500-\u052F\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0E00-\u0E7F]/;

function coerceSectionItems(raw: unknown, section: StoryStateUpdateSection): StoryStateUpdateItem[] {
  const parsed = sectionListSchema.safeParse(raw);
  if (!parsed.success || !parsed.data) {
    return [];
  }

  return parsed.data
    .flatMap((item) => (typeof item === 'string' ? [item.trim()] : []))
    .filter((text) => text.length > 0 && !foreignScriptPattern.test(text))
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

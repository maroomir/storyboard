import yaml from 'js-yaml';
import { z, ZodError } from 'zod';

import { elementIdSchema } from '#model/element/elementId';
import { ChapterPlanParseError } from '#model/format/files/outline';
import { outlineVersion } from '#model/format/outline';

export interface ChapterOutlineChapter {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly targetWordCount?: number;
  readonly narrator?: string;
  readonly thread?: string;
  readonly scenes: readonly string[];
}

export interface ChapterOutlineAct {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly chapters: readonly ChapterOutlineChapter[];
}

export interface ChapterOutline {
  readonly version: string;
  readonly acts: readonly ChapterOutlineAct[];
}

const chapterOutlineChapterSchema: z.ZodType<ChapterOutlineChapter> = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1).optional(),
    targetWordCount: z.number().int().positive().optional(),
    narrator: z.string().trim().min(1).optional(),
    thread: z.string().trim().min(1).optional(),
    scenes: z.array(elementIdSchema).readonly().default([]),
  })
  .strict();

const chapterOutlineActSchema: z.ZodType<ChapterOutlineAct> = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1).optional(),
    chapters: z.array(chapterOutlineChapterSchema).readonly().default([]),
  })
  .strict();

export const chapterOutlineSchema: z.ZodType<ChapterOutline> = z
  .object({
    version: z.literal(outlineVersion),
    acts: z.array(chapterOutlineActSchema).readonly().default([]),
  })
  .strict();

export function parseChapterOutline(rawOutline: string): ChapterOutline {
  let parsedYaml: unknown;

  try {
    parsedYaml = yaml.load(rawOutline);
  } catch (error) {
    throw new ChapterPlanParseError('invalid-yaml', 'chapters.yaml을 파싱할 수 없습니다.', error);
  }

  try {
    return chapterOutlineSchema.parse(parsedYaml);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ChapterPlanParseError(
        'invalid-chapter-plan-schema',
        'chapters.yaml 스키마가 올바르지 않습니다.',
        error,
      );
    }

    throw error;
  }
}

export function serializeChapterOutline(outline: ChapterOutline): string {
  return yaml.dump(chapterOutlineSchema.parse(outline), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

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

function mapOutlineChapters(
  outline: ChapterOutline,
  transform: (chapter: ChapterOutlineChapter) => ChapterOutlineChapter,
): ChapterOutline {
  return {
    ...outline,
    acts: outline.acts.map((act) => ({ ...act, chapters: act.chapters.map(transform) })),
  };
}

function isSceneListed(outline: ChapterOutline, sceneId: string): boolean {
  return outline.acts.some((act) =>
    act.chapters.some((chapter) => chapter.scenes.includes(sceneId)),
  );
}

export function removeSceneFromOutline(outline: ChapterOutline, sceneId: string): ChapterOutline {
  return mapOutlineChapters(outline, (chapter) => ({
    ...chapter,
    scenes: chapter.scenes.filter((id) => id !== sceneId),
  }));
}

function prependToFirstChapter(outline: ChapterOutline, sceneId: string): ChapterOutline {
  let isPlaced: boolean = false;

  return mapOutlineChapters(outline, (chapter) => {
    if (isPlaced) {
      return chapter;
    }

    isPlaced = true;
    return { ...chapter, scenes: [sceneId, ...chapter.scenes] };
  });
}

export function placeSceneAfterInOutline(
  outline: ChapterOutline,
  sceneId: string,
  afterSceneId: string | undefined,
): ChapterOutline {
  const isTargetListed: boolean =
    afterSceneId === undefined || isSceneListed(outline, afterSceneId);
  if (!isSceneListed(outline, sceneId) || !isTargetListed) {
    return outline;
  }

  const withoutScene: ChapterOutline = removeSceneFromOutline(outline, sceneId);
  if (afterSceneId === undefined) {
    return prependToFirstChapter(withoutScene, sceneId);
  }

  return mapOutlineChapters(withoutScene, (chapter) => ({
    ...chapter,
    scenes: chapter.scenes.flatMap((id) => (id === afterSceneId ? [id, sceneId] : [id])),
  }));
}

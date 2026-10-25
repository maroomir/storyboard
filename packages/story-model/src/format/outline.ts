import { z } from 'zod';

import { cardIdPattern, characterRoles, type CharacterRole } from './card';
import {
  pointOfViews,
  type CompositionKind,
  type PointOfView,
  type ProjectFormat,
  type ProjectSetting,
  type StoryboardProject,
} from './project';

export const outlineVersion: string = '1.0.0';

export interface OutlineSynopsis {
  readonly logline: string;
  readonly genrePromise: string;
  readonly mainConflicts: readonly string[];
  readonly ending: string;
  readonly theme: string;
  readonly tone: string;
  readonly pov?: PointOfView;
  readonly styleRules: readonly string[];
}

export interface ScenePlan {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly characters: readonly string[];
  readonly location?: string;
  readonly conflict?: string;
  readonly twist?: string;
  readonly emotionalShift?: string;
  readonly foreshadowing: readonly string[];
  readonly neededCanon?: readonly string[];
  readonly targetWordCount?: number;
}

export interface ChapterPlanChapter {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly targetWordCount?: number;
  readonly narrator?: string;
  readonly thread?: string;
  readonly scenes: readonly ScenePlan[];
}

export interface ChapterPlanAct {
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  readonly chapters: readonly ChapterPlanChapter[];
}

export interface ChapterPlan {
  readonly version: typeof outlineVersion;
  readonly acts: readonly ChapterPlanAct[];
}

const outlineSynopsisShape = {
  logline: z.string().trim().default(''),
  genrePromise: z.string().trim().default(''),
  mainConflicts: z.array(z.string().trim().min(1)).default([]),
  ending: z.string().trim().default(''),
  theme: z.string().trim().default(''),
  tone: z.string().trim().default(''),
  pov: z.enum(pointOfViews).optional(),
  styleRules: z.array(z.string().trim().min(1)).default([]),
} satisfies z.ZodRawShape;

export const outlineSynopsisSchema: z.ZodType<OutlineSynopsis> = z.object(outlineSynopsisShape);

interface ScenePlanPayload {
  id: string;
  title: string;
  purpose: string;
  characters: string[];
  foreshadowing: string[];
  neededCanon: string[];
  location?: string;
  conflict?: string;
  twist?: string;
  emotionalShift?: string;
  targetWordCount?: number;
}

const scenePlanSchema: z.ZodType<ScenePlanPayload> = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  purpose: z.string().trim().default(''),
  characters: z.array(z.string().trim().min(1)).default([]),
  location: z.string().trim().min(1).optional(),
  conflict: z.string().trim().min(1).optional(),
  twist: z.string().trim().min(1).optional(),
  emotionalShift: z.string().trim().min(1).optional(),
  foreshadowing: z.array(z.string().trim().min(1)).default([]),
  neededCanon: z.array(z.string().trim().min(1)).default([]),
  targetWordCount: z.number().int().positive().optional(),
});

interface ChapterPlanChapterPayload {
  id: string;
  title: string;
  scenes: ScenePlanPayload[];
  summary?: string;
  targetWordCount?: number;
  narrator?: string;
  thread?: string;
}

const chapterPlanChapterSchema: z.ZodType<ChapterPlanChapterPayload> = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  targetWordCount: z.number().int().positive().optional(),
  narrator: z.string().trim().min(1).optional(),
  thread: z.string().trim().min(1).optional(),
  scenes: z.array(scenePlanSchema).default([]),
});

interface ChapterPlanActPayload {
  id: string;
  title: string;
  chapters: ChapterPlanChapterPayload[];
  summary?: string;
}

const chapterPlanActSchema: z.ZodType<ChapterPlanActPayload> = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  chapters: z.array(chapterPlanChapterSchema).default([]),
});

export interface ChapterPlanPayload {
  version: string;
  acts: ChapterPlanActPayload[];
}

export const chapterPlanSchema: z.ZodType<ChapterPlanPayload> = z.object({
  version: z.literal(outlineVersion),
  acts: z.array(chapterPlanActSchema).default([]),
});

export interface OutlineBrief {
  readonly projectName: string;
  readonly format: ProjectFormat;
  readonly language: string;
  readonly genre?: string;
  readonly audience?: string;
  readonly pov?: PointOfView;
  readonly targetWordCount?: number;
  readonly chapterCount?: number;
  readonly scenesPerChapter?: number;
  readonly concept?: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly prohibitions: readonly string[];
  readonly styleConstraints: readonly string[];
  readonly qualityCriteria: readonly string[];
  readonly composition?: CompositionKind;
  readonly threads: readonly OutlineThreadBrief[];
  readonly narratorIds: readonly string[];
}

export interface OutlineThreadBrief {
  readonly id: string;
  readonly title: string;
  readonly wraps?: readonly string[];
}

export interface OutlineCharacterBrief {
  readonly id: string;
  readonly name: string;
  readonly role?: string;
}

export interface OutlineCastMember {
  readonly id: string;
  readonly sceneTitles: readonly string[];
}

export interface OutlineCharacterDraft {
  readonly id: string;
  readonly name: string;
  readonly role?: CharacterRole;
  readonly description: readonly string[];
}

export interface UncastCharacters {
  readonly cast: readonly OutlineCastMember[];
  readonly unusableIds: readonly string[];
}

export function findUncastCharacters(
  plan: ChapterPlan,
  existingIds: ReadonlySet<string>,
): UncastCharacters {
  const sceneTitlesById: Map<string, Set<string>> = new Map<string, Set<string>>();
  const unusableIds: Set<string> = new Set<string>();

  for (const { scene } of flattenChapterPlan(plan)) {
    for (const id of scene.characters) {
      if (existingIds.has(id)) {
        continue;
      }
      if (!cardIdPattern.test(id)) {
        unusableIds.add(id);
        continue;
      }
      sceneTitlesById.set(id, (sceneTitlesById.get(id) ?? new Set()).add(scene.title));
    }
  }

  return {
    cast: [...sceneTitlesById].map(([id, sceneTitles]) => ({ id, sceneTitles: [...sceneTitles] })),
    unusableIds: [...unusableIds],
  };
}

export function coerceOutlineCharacters(
  raw: unknown,
  requestedIds: readonly string[],
): OutlineCharacterDraft[] {
  const entries: unknown[] = isRecord(raw) ? asArray(raw.characters) : asArray(raw);
  const drafts: Map<string, OutlineCharacterDraft> = new Map<string, OutlineCharacterDraft>();

  for (const entry of entries) {
    const record: Record<string, unknown> = isRecord(entry) ? entry : {};
    const id: string | undefined = text(record.id);

    if (id === undefined || !requestedIds.includes(id) || drafts.has(id)) {
      continue;
    }

    const role: string | undefined = text(record.role)?.toLowerCase();
    drafts.set(id, {
      id,
      name: text(record.name) ?? id,
      ...(role !== undefined && (characterRoles as readonly string[]).includes(role)
        ? { role: role as CharacterRole }
        : {}),
      description: textList(record.description),
    });
  }

  return [...drafts.values()];
}

export interface FlatChapterScene {
  readonly scene: ScenePlan;
  readonly actTitle: string;
  readonly chapterTitle: string;
  readonly actIndex: number;
  readonly chapterIndex: number;
  readonly chapterNarrator?: string;
  readonly chapterThread?: string;
}

export function flattenChapterPlan(plan: ChapterPlan): FlatChapterScene[] {
  const flatScenes: FlatChapterScene[] = [];

  plan.acts.forEach((act, actIndex) => {
    act.chapters.forEach((chapter, chapterIndex) => {
      for (const scene of chapter.scenes) {
        flatScenes.push({
          scene,
          actTitle: act.title,
          chapterTitle: chapter.title,
          actIndex,
          chapterIndex,
          ...(chapter.narrator === undefined ? {} : { chapterNarrator: chapter.narrator }),
          ...(chapter.thread === undefined ? {} : { chapterThread: chapter.thread }),
        });
      }
    });
  });

  return flatScenes;
}

export function toOutlineBrief(
  project: StoryboardProject,
  narratorIds: readonly string[] = [],
): OutlineBrief {
  const setting: ProjectSetting | undefined = project.setting;

  return {
    composition: setting?.composition,
    threads: Object.entries(setting?.threads ?? {}).map(([id, thread]) => ({
      id,
      title: thread.title,
      ...(thread.wraps === undefined ? {} : { wraps: thread.wraps }),
    })),
    narratorIds,
    projectName: project.name,
    format: project.format,
    language: project.language,
    genre: setting?.genre,
    audience: setting?.audience,
    pov: setting?.pov,
    targetWordCount: setting?.targetWordCount,
    chapterCount: setting?.chapterCount,
    scenesPerChapter: setting?.scenesPerChapter,
    concept: setting?.concept,
    description: setting?.description,
    tags: setting?.tags ?? [],
    prohibitions: setting?.prohibitions ?? [],
    styleConstraints: setting?.styleConstraints ?? [],
    qualityCriteria: setting?.qualityCriteria ?? [],
  };
}

export function coerceOutlineSynopsis(raw: unknown, brief: OutlineBrief): OutlineSynopsis {
  const record: Record<string, unknown> = isRecord(raw) ? raw : {};
  const parsed: z.ZodSafeParseResult<OutlineSynopsis> = outlineSynopsisSchema.safeParse(record);

  if (parsed.success) {
    return { ...parsed.data, pov: parsed.data.pov ?? brief.pov };
  }

  const empty: OutlineSynopsis = outlineSynopsisSchema.parse({});
  const salvaged: Record<string, unknown> = { ...empty };
  for (const key of Object.keys(outlineSynopsisShape) as (keyof typeof outlineSynopsisShape)[]) {
    const fieldSchema: z.ZodType = outlineSynopsisShape[key];
    const fieldValue: unknown = record[key];
    const fieldParsed: z.ZodSafeParseResult<unknown> = fieldSchema.safeParse(fieldValue);
    if (fieldParsed.success && fieldParsed.data !== undefined) {
      salvaged[key] = fieldParsed.data;
    }
  }

  const synopsis: OutlineSynopsis = salvaged as unknown as OutlineSynopsis;
  return { ...synopsis, pov: synopsis.pov ?? brief.pov };
}

export function emptyOutlineSynopsis(): OutlineSynopsis {
  return outlineSynopsisSchema.parse({}) as OutlineSynopsis;
}

export function coerceChapterPlan(raw: unknown): ChapterPlan {
  const actsRaw: unknown[] = isRecord(raw) ? asArray(raw.acts) : asArray(raw);

  const acts: ChapterPlan['acts'] = actsRaw.map((actRaw, actIndex) => {
    const act: Record<string, unknown> = isRecord(actRaw) ? actRaw : {};
    const chaptersRaw: unknown[] = asArray(act.chapters);

    return {
      id: text(act.id) ?? `act-${actIndex + 1}`,
      title: text(act.title) ?? `${actIndex + 1}막`,
      ...optionalText('summary', act.summary),
      chapters: chaptersRaw.map((chapterRaw, chapterIndex) => {
        const chapter: Record<string, unknown> = isRecord(chapterRaw) ? chapterRaw : {};
        const scenesRaw: unknown[] = asArray(chapter.scenes);

        return {
          id: text(chapter.id) ?? `chapter-${actIndex + 1}-${chapterIndex + 1}`,
          title: text(chapter.title) ?? `${chapterIndex + 1}장`,
          ...optionalText('summary', chapter.summary),
          ...optionalPositiveInt('targetWordCount', chapter.targetWordCount),
          scenes: scenesRaw.map((sceneRaw, sceneIndex) => {
            const scene: Record<string, unknown> = isRecord(sceneRaw) ? sceneRaw : {};

            return {
              id: text(scene.id) ?? `scene-${actIndex + 1}-${chapterIndex + 1}-${sceneIndex + 1}`,
              title: text(scene.title) ?? `씬 ${sceneIndex + 1}`,
              purpose: text(scene.purpose) ?? '',
              characters: textList(scene.characters),
              ...optionalText('location', scene.location),
              ...optionalText('conflict', scene.conflict),
              ...optionalText('twist', scene.twist),
              ...optionalText('emotionalShift', scene.emotionalShift),
              foreshadowing: textList(scene.foreshadowing),
              neededCanon: textList(scene.neededCanon),
              ...optionalPositiveInt('targetWordCount', scene.targetWordCount),
            };
          }),
        };
      }),
    };
  });

  return chapterPlanSchema.parse({ version: outlineVersion, acts });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function textList(value: unknown): string[] {
  return asArray(value)
    .map((item) => text(item))
    .filter((item): item is string => item !== undefined);
}

function optionalText(key: string, value: unknown): Record<string, string> {
  const trimmed: string | undefined = text(value);
  return trimmed !== undefined ? { [key]: trimmed } : {};
}

function optionalPositiveInt(key: string, value: unknown): Record<string, number> {
  const parsed: unknown = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0
    ? { [key]: parsed }
    : {};
}

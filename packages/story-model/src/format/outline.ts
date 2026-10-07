import { z } from 'zod';

import { cardIdPattern, characterRoles, type CharacterRole } from './card';
import {
  pointOfViews,
  type CompositionKind,
  type PointOfView,
  type ProjectFormat,
  type StoryboardProject,
} from './project';

export const outlineVersion = '1.0.0';

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
  // 이 장의 기본 서술자와 연속성 줄기. 씬 카드가 값을 가지면 씬이 이긴다.
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

export const outlineSynopsisSchema = z.object({
  logline: z.string().trim().default(''),
  genrePromise: z.string().trim().default(''),
  mainConflicts: z.array(z.string().trim().min(1)).default([]),
  ending: z.string().trim().default(''),
  theme: z.string().trim().default(''),
  tone: z.string().trim().default(''),
  pov: z.enum(pointOfViews).optional(),
  styleRules: z.array(z.string().trim().min(1)).default([]),
});

const scenePlanSchema = z.object({
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

const chapterPlanChapterSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  targetWordCount: z.number().int().positive().optional(),
  narrator: z.string().trim().min(1).optional(),
  thread: z.string().trim().min(1).optional(),
  scenes: z.array(scenePlanSchema).default([]),
});

const chapterPlanActSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  chapters: z.array(chapterPlanChapterSchema).default([]),
});

export const chapterPlanSchema = z.object({
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
  // 구성이 아웃라인 프롬프트를 바꾼다. 옴니버스는 편마다 독립된 결말을, 시점 교차는 장마다 다른
  // 서술자를, 액자식은 외화를 앞뒤에 두도록 지시한다.
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

// A character the chapter plan casts but no card describes yet, with the scenes it appears in.
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

// The cast the plan names without a card. An id that cannot be a card file name is left out: no
// card could answer it, so the scene that names it resolves its other characters instead.
export function findUncastCharacters(
  plan: ChapterPlan,
  existingIds: ReadonlySet<string>,
): OutlineCastMember[] {
  const sceneTitlesById = new Map<string, string[]>();

  for (const { scene } of flattenChapterPlan(plan)) {
    for (const id of scene.characters) {
      if (existingIds.has(id) || !cardIdPattern.test(id)) {
        continue;
      }
      sceneTitlesById.set(id, [...(sceneTitlesById.get(id) ?? []), scene.title]);
    }
  }

  return [...sceneTitlesById].map(([id, sceneTitles]) => ({ id, sceneTitles }));
}

// Keeps only the ids that were asked for, so a model cannot add a card nobody casts.
export function coerceOutlineCharacters(
  raw: unknown,
  requestedIds: readonly string[],
): OutlineCharacterDraft[] {
  const entries = isRecord(raw) ? asArray(raw.characters) : asArray(raw);
  const drafts = new Map<string, OutlineCharacterDraft>();

  for (const entry of entries) {
    const record = isRecord(entry) ? entry : {};
    const id = text(record.id);

    if (id === undefined || !requestedIds.includes(id) || drafts.has(id)) {
      continue;
    }

    const role = text(record.role)?.toLowerCase();
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
  // 씬 시드가 물려받을 장의 서술자·줄기. 시점 교차는 이 값을 씬마다 복사해 표현한다.
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
  const setting = project.setting;

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
  const record = isRecord(raw) ? raw : {};
  const parsed = outlineSynopsisSchema.safeParse(record);

  if (parsed.success) {
    return { ...parsed.data, pov: parsed.data.pov ?? brief.pov };
  }

  // One malformed field (e.g. a blank conflict entry) must not reset the whole synopsis: salvage
  // every field that validates on its own and default only the broken ones.
  const empty = outlineSynopsisSchema.parse({});
  const salvaged: Record<string, unknown> = { ...empty };
  for (const key of Object.keys(
    outlineSynopsisSchema.shape,
  ) as (keyof typeof outlineSynopsisSchema.shape)[]) {
    const fieldSchema = outlineSynopsisSchema.shape[key];
    const fieldValue = record[key];
    const fieldParsed = fieldSchema.safeParse(fieldValue);
    if (fieldParsed.success && fieldParsed.data !== undefined) {
      salvaged[key] = fieldParsed.data;
    }
  }

  const data = salvaged as unknown as OutlineSynopsis;
  return { ...data, pov: data.pov ?? brief.pov };
}

export function emptyOutlineSynopsis(): OutlineSynopsis {
  return outlineSynopsisSchema.parse({}) as OutlineSynopsis;
}

export function coerceChapterPlan(raw: unknown): ChapterPlan {
  const actsRaw = isRecord(raw) ? asArray(raw.acts) : asArray(raw);

  const acts = actsRaw.map((actRaw, actIndex) => {
    const act = isRecord(actRaw) ? actRaw : {};
    const chaptersRaw = asArray(act.chapters);

    return {
      id: text(act.id) ?? `act-${actIndex + 1}`,
      title: text(act.title) ?? `${actIndex + 1}막`,
      ...optionalText('summary', act.summary),
      chapters: chaptersRaw.map((chapterRaw, chapterIndex) => {
        const chapter = isRecord(chapterRaw) ? chapterRaw : {};
        const scenesRaw = asArray(chapter.scenes);

        return {
          id: text(chapter.id) ?? `chapter-${actIndex + 1}-${chapterIndex + 1}`,
          title: text(chapter.title) ?? `${chapterIndex + 1}장`,
          ...optionalText('summary', chapter.summary),
          ...optionalPositiveInt('targetWordCount', chapter.targetWordCount),
          scenes: scenesRaw.map((sceneRaw, sceneIndex) => {
            const scene = isRecord(sceneRaw) ? sceneRaw : {};

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
  const trimmed = text(value);
  return trimmed !== undefined ? { [key]: trimmed } : {};
}

function optionalPositiveInt(key: string, value: unknown): Record<string, number> {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0
    ? { [key]: parsed }
    : {};
}

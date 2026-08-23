import { z } from 'zod';

export const sceneFileNamePattern = /^(\d+)-([a-z0-9][a-z0-9-]*)\.txt$/;
export const sceneStemPattern = /^(\d+)-([a-z0-9][a-z0-9-]*)$/;

// 씬을 구체적인 사건으로 못박는 4개 사실. 가사·분위기 스케치처럼 추상적인 씬이 은유만으로
// 생성되는 것을 막는다.
export const sceneGroundingFieldKeys = ['incident', 'place', 'relation', 'time'] as const;

export type SceneGroundingFieldKey = (typeof sceneGroundingFieldKeys)[number];

export const sceneGroundingSchema = z.object({
  incident: z.string().trim().min(1).optional(),
  place: z.string().trim().min(1).optional(),
  relation: z.string().trim().min(1).optional(),
  time: z.string().trim().min(1).optional(),
});

export type SceneGrounding = z.infer<typeof sceneGroundingSchema>;

export const sceneGroundingFieldLabels: Readonly<Record<SceneGroundingFieldKey, string>> = {
  incident: '사건',
  place: '장소',
  relation: '관계',
  time: '시점',
};

export const sceneFrontmatterSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    characters: z.array(z.string().trim().min(1)).optional(),
    location: z.string().trim().min(1).optional(),
    mood: z.string().trim().min(1).optional(),
    relationStage: z.string().trim().min(1).optional(),
    targetWordCount: z.number().int().positive().optional(),
    grounding: sceneGroundingSchema.optional(),
  })
  .passthrough();

export interface SceneFileNameParts {
  readonly stem: string;
  readonly order: number;
  readonly orderText: string;
  readonly slug: string;
}

export type SceneFrontmatter = z.infer<typeof sceneFrontmatterSchema>;

export interface SceneFile {
  readonly stem: string;
  readonly order: number;
  readonly orderText: string;
  readonly slug: string;
  readonly frontmatter: SceneFrontmatter;
  readonly body: string;
}

export function parseSceneFileName(fileName: string): SceneFileNameParts | undefined {
  const match = sceneFileNamePattern.exec(fileName);

  if (!match) {
    return undefined;
  }

  const orderText = match[1];
  const slug = match[2];

  if (!orderText || !slug) {
    return undefined;
  }

  return {
    stem: `${orderText}-${slug}`,
    order: Number.parseInt(orderText, 10),
    orderText,
    slug,
  };
}

export function parseSceneStem(stem: string): SceneFileNameParts | undefined {
  const match = sceneStemPattern.exec(stem);

  if (!match) {
    return undefined;
  }

  const orderText = match[1];
  const slug = match[2];

  if (!orderText || !slug) {
    return undefined;
  }

  return {
    stem,
    order: Number.parseInt(orderText, 10),
    orderText,
    slug,
  };
}

// NOTE: File-agnostic timeline coordinate for canon-fact validity ranges. Accepts a bare
// order, a numeric string, or an `NN-slug` scene stem; returns undefined for anything else.
export function resolveSceneOrder(ref: string | number): number | undefined {
  if (typeof ref === 'number') {
    return Number.isInteger(ref) && ref > 0 ? ref : undefined;
  }

  const trimmed = ref.trim();

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  return parseSceneStem(trimmed)?.order;
}

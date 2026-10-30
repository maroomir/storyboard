import { z } from 'zod';

import { craftContractOverrideSchema, type CraftContractOverride } from '#model/format/craftContract';

export const storyboardProjectVersion: string = '1.0.0';

export type ProjectFormat = 'novel' | 'screenplay' | 'play' | 'essay' | 'poem';

export const projectFormats: readonly [ProjectFormat, ...ProjectFormat[]] = [
  'novel',
  'screenplay',
  'play',
  'essay',
  'poem',
];

export type PointOfView =
  | 'first'
  | 'first-retrospective'
  | 'second'
  | 'third-limited'
  | 'third-omniscient';

export const pointOfViews: readonly [PointOfView, ...PointOfView[]] = [
  'first',
  'first-retrospective',
  'second',
  'third-limited',
  'third-omniscient',
];

export interface NarrativeChoiceLabels {
  readonly label: string;
  readonly optionLabel: string;
}

export const pointOfViewCatalog: Record<PointOfView, NarrativeChoiceLabels> = {
  first: { label: '1인칭', optionLabel: '1인칭' },
  'first-retrospective': {
    label: '1인칭 회고',
    optionLabel: '1인칭 회고 (결말을 아는 화자)',
  },
  second: { label: '2인칭', optionLabel: '2인칭' },
  'third-limited': { label: '3인칭 제한적', optionLabel: '3인칭 제한적 시점' },
  'third-omniscient': { label: '3인칭 전지적', optionLabel: '3인칭 전지적 시점' },
};

export const pointOfViewLabels: Record<PointOfView, string> = Object.fromEntries(
  pointOfViews.map((pov) => [pov, pointOfViewCatalog[pov].label]),
) as Record<PointOfView, string>;

export type ContractFieldKey = 'genre' | 'audience' | 'pov' | 'targetWordCount';

export const contractFieldKeys: readonly [ContractFieldKey, ...ContractFieldKey[]] = [
  'genre',
  'audience',
  'pov',
  'targetWordCount',
];

export const contractFieldLabels: Record<ContractFieldKey, string> = {
  genre: '장르',
  audience: '독자층',
  pov: '시점',
  targetWordCount: '목표 분량',
};

export interface ProjectEditor {
  scenePrefixDigits: number;
  trackDraft?: boolean;
}

export const projectEditorSchema: z.ZodType<ProjectEditor> = z.object({
  scenePrefixDigits: z.number().int().positive(),
  trackDraft: z.boolean().optional(),
});

export type CompositionKind = 'linear' | 'omnibus' | 'alternating-pov' | 'frame';

export const compositionKinds: readonly [CompositionKind, ...CompositionKind[]] = [
  'linear',
  'omnibus',
  'alternating-pov',
  'frame',
];

export const compositionCatalog: Record<CompositionKind, NarrativeChoiceLabels> = {
  linear: { label: '선형', optionLabel: '선형 — 한 줄기로 이어지는 이야기' },
  omnibus: { label: '옴니버스', optionLabel: '옴니버스 — 편마다 독립된 사건과 결말' },
  'alternating-pov': { label: '시점 교차', optionLabel: '시점 교차 — 장마다 서술자가 바뀜' },
  frame: { label: '액자식', optionLabel: '액자식 — 외화가 내화를 감쌈' },
};

export const compositionKindLabels: Record<CompositionKind, string> = Object.fromEntries(
  compositionKinds.map((kind) => [kind, compositionCatalog[kind].label]),
) as Record<CompositionKind, string>;

export interface StoryThread {
  title: string;
  wraps?: readonly string[];
}

export interface StoryThreadEntry {
  readonly id: string;
  readonly title: string;
  readonly wraps?: readonly string[];
}

export const storyThreadSchema: z.ZodType<StoryThread> = z.object({
  title: z.string().trim().min(1),
  wraps: z.array(z.string().trim().min(1)).readonly().optional(),
});

export const mainThreadId: string = 'main';

export interface ProjectNarration {
  defaultNarrator?: string;
}

export const projectNarrationSchema: z.ZodType<ProjectNarration> = z.object({
  defaultNarrator: z.string().trim().min(1).optional(),
});

export interface ProjectSetting {
  tags: string[];
  prohibitions: string[];
  styleConstraints: string[];
  qualityCriteria: string[];
  genre?: string;
  country?: string;
  concept?: string;
  description?: string;
  audience?: string;
  targetWordCount?: number;
  pov?: PointOfView;
  narration?: ProjectNarration;
  composition?: CompositionKind;
  threads?: Record<string, StoryThread>;
  chapterCount?: number;
  scenesPerChapter?: number;
  craftContract?: CraftContractOverride;
}

export const projectSettingSchema: z.ZodType<ProjectSetting> = z.object({
  genre: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  concept: z.string().trim().min(1).optional(),
  tags: z.array(z.string()).default([]),
  description: z.string().optional(),
  audience: z.string().trim().min(1).optional(),
  targetWordCount: z.number().int().positive().optional(),
  pov: z.enum(pointOfViews).optional(),
  narration: projectNarrationSchema.optional(),
  composition: z.enum(compositionKinds).optional(),
  threads: z.record(z.string().trim().min(1), storyThreadSchema).readonly().optional(),
  chapterCount: z.number().int().positive().optional(),
  scenesPerChapter: z.number().int().positive().optional(),
  prohibitions: z.array(z.string()).default([]),
  styleConstraints: z.array(z.string()).default([]),
  qualityCriteria: z.array(z.string()).default([]),
  craftContract: craftContractOverrideSchema.optional(),
});

export interface StoryboardProject {
  version: string;
  id: string;
  name: string;
  format: ProjectFormat;
  language: string;
  createdAt: string;
  editor: ProjectEditor;
  setting?: ProjectSetting;
}

export const storyboardProjectSchema: z.ZodType<StoryboardProject> = z.object({
  version: z.literal(storyboardProjectVersion),
  id: z.string().min(1),
  name: z.string().trim().min(1),
  format: z.enum(projectFormats),
  language: z.string().trim().min(1),
  createdAt: z.string().datetime(),
  editor: projectEditorSchema,
  setting: projectSettingSchema.optional(),
});

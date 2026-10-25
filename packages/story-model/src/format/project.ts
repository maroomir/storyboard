import { z } from 'zod';

import { craftContractOverrideSchema } from './craftContract';

export const storyboardProjectVersion: string = '1.0.0';

export const projectFormats = ['novel', 'screenplay', 'play', 'essay', 'poem'] as const;

export type ProjectFormat = (typeof projectFormats)[number];

// NOTE: 창작자가 고르는 시점 목록. 서술자 카드를 만들지 않아도 이 값 하나로 서술 인칭·지식 경계가
// 정해진다(암묵 서술자). 값 추가는 하위 호환이다 — 기존 세 값의 의미는 그대로다.
export const pointOfViews = [
  'first',
  'first-retrospective',
  'second',
  'third-limited',
  'third-omniscient',
] as const;

export type PointOfView = (typeof pointOfViews)[number];

// 이름이 쓰이는 자리가 둘이라 칸도 둘이다. `label` 은 아웃라인 본문처럼 «시점: » 뒤에 붙는 짧은
// 이름이고, `optionLabel` 은 고르는 자리에서 혼자 서는 이름이다.
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

export const contractFieldKeys = ['genre', 'audience', 'pov', 'targetWordCount'] as const;

export type ContractFieldKey = (typeof contractFieldKeys)[number];

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

// 구성. 스레드와 서술자를 어떻게 배치할지 정하는 프리셋이며, 실제 배치는 프리셋이 threads와
// 아웃라인 지시로 풀어낸다.
export const compositionKinds = ['linear', 'omnibus', 'alternating-pov', 'frame'] as const;

export type CompositionKind = (typeof compositionKinds)[number];

export const compositionCatalog: Record<CompositionKind, NarrativeChoiceLabels> = {
  linear: { label: '선형', optionLabel: '선형 — 한 줄기로 이어지는 이야기' },
  omnibus: { label: '옴니버스', optionLabel: '옴니버스 — 편마다 독립된 사건과 결말' },
  'alternating-pov': { label: '시점 교차', optionLabel: '시점 교차 — 장마다 서술자가 바뀜' },
  frame: { label: '액자식', optionLabel: '액자식 — 외화가 내화를 감쌈' },
};

export const compositionKindLabels: Record<CompositionKind, string> = Object.fromEntries(
  compositionKinds.map((kind) => [kind, compositionCatalog[kind].label]),
) as Record<CompositionKind, string>;

// 연속성 줄기. 이야기 상태·장 요약·직전 씬 맥락은 스레드 안에서만 이어지고, 캐넌만 전역이다.
export interface StoryThread {
  title: string;
  wraps?: readonly string[];
}

export const storyThreadSchema: z.ZodType<StoryThread> = z.object({
  title: z.string().trim().min(1),
  // 액자식에서 이 스레드가 감싸는 내부 스레드. 조립할 때 외화를 앞뒤에 두는 근거가 된다.
  wraps: z.array(z.string().trim().min(1)).readonly().optional(),
});

export const mainThreadId: string = 'main';

export interface ProjectNarration {
  defaultNarrator?: string;
}

export const projectNarrationSchema: z.ZodType<ProjectNarration> = z.object({
  // 이름 붙인 기본 서술자(`narrator/<id>.card`). 없으면 `pov`에서 암묵 서술자를 파생한다.
  defaultNarrator: z.string().trim().min(1).optional(),
});

export interface ProjectSettingCraftContract {
  banTelling?: boolean;
  motifRepeatLimit?: number;
  stockGestureBlacklist?: readonly string[];
  requireCharacterInterior?: boolean;
  actionClarity?: boolean;
  modulateDensity?: boolean;
  sceneLengthMultiplier?: number;
}

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
  craftContract?: ProjectSettingCraftContract;
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
  // 아웃라인이 만들 장·씬 개수. 작품마다 한 번 정하는 값이라 계약에 둔다.
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

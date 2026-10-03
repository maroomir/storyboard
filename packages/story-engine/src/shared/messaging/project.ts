import { z } from 'zod';

import {
  compositionKinds,
  contractFieldKeys,
  pointOfViews,
  projectFormats,
} from '@storyboard/story-model/contracts';

const generationContractReadinessSchema = z.object({
  isReady: z.boolean(),
  missing: z.array(z.enum(contractFieldKeys)),
  warnings: z.array(z.string()),
});

const contractThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  wraps: z.array(z.string()).optional(),
});

const generationContractSettingSchema = z.object({
  genre: z.string().optional(),
  audience: z.string().optional(),
  pov: z.enum(pointOfViews).optional(),
  composition: z.enum(compositionKinds).optional(),
  // 웹뷰는 편집하지 않고 보여만 준다. 줄기는 구성 프리셋이 만드는 값이라 손으로 고칠 자리가 아니다.
  threads: z.array(contractThreadSchema),
  narrators: z.array(z.object({ id: z.string(), name: z.string(), summary: z.string() })),
  targetWordCount: z.number().int().positive().optional(),
  prohibitions: z.array(z.string()),
  styleConstraints: z.array(z.string()),
  qualityCriteria: z.array(z.string()),
});

const projectContractSnapshotSchema = z.object({
  isStoryboardProject: z.boolean(),
  format: z.enum(projectFormats).optional(),
  setting: generationContractSettingSchema.optional(),
  readiness: generationContractReadinessSchema,
});

export const projectReadContractRequestPayloadSchema = z.object({});

export const projectReadContractResponsePayloadSchema = projectContractSnapshotSchema;

export const projectUpdateContractRequestPayloadSchema = z.object({
  genre: z.string().trim().optional(),
  audience: z.string().trim().optional(),
  pov: z.enum(pointOfViews).nullable().optional(),
  composition: z.enum(compositionKinds).nullable().optional(),
  // 시점 교차 프리셋이 서술자 카드를 만들 인물 id.
  povCharacters: z.array(z.string()).optional(),
  episodeCount: z.number().int().positive().optional(),
  targetWordCount: z.number().int().positive().nullable().optional(),
  prohibitions: z.array(z.string()).optional(),
  styleConstraints: z.array(z.string()).optional(),
  qualityCriteria: z.array(z.string()).optional(),
});

export const projectUpdateContractResponsePayloadSchema = projectContractSnapshotSchema;

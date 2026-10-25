import { z } from 'zod';

import {
  compositionKinds,
  contractFieldKeys,
  pointOfViews,
  projectFormats,
  type CompositionKind,
  type ContractFieldKey,
  type PointOfView,
  type ProjectFormat,
  type StoryThreadEntry,
} from '#model/format/project';

export interface GenerationContractReadiness {
  readonly isReady: boolean;
  readonly missing: ContractFieldKey[];
  readonly warnings: string[];
}

const generationContractReadinessSchema: z.ZodType<GenerationContractReadiness> = z.object({
  isReady: z.boolean(),
  missing: z.array(z.enum(contractFieldKeys)),
  warnings: z.array(z.string()),
});

const contractThreadSchema: z.ZodType<StoryThreadEntry> = z.object({
  id: z.string(),
  title: z.string(),
  wraps: z.array(z.string()).optional(),
});

export interface NarratorSummary {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
}

export interface GenerationContractSetting {
  threads: StoryThreadEntry[];
  narrators: NarratorSummary[];
  prohibitions: string[];
  styleConstraints: string[];
  qualityCriteria: string[];
  genre?: string;
  audience?: string;
  pov?: PointOfView;
  composition?: CompositionKind;
  targetWordCount?: number;
}

const generationContractSettingSchema: z.ZodType<GenerationContractSetting> = z.object({
  genre: z.string().optional(),
  audience: z.string().optional(),
  pov: z.enum(pointOfViews).optional(),
  composition: z.enum(compositionKinds).optional(),
  threads: z.array(contractThreadSchema),
  narrators: z.array(z.object({ id: z.string(), name: z.string(), summary: z.string() })),
  targetWordCount: z.number().int().positive().optional(),
  prohibitions: z.array(z.string()),
  styleConstraints: z.array(z.string()),
  qualityCriteria: z.array(z.string()),
});

interface ProjectContractSnapshot {
  isStoryboardProject: boolean;
  readiness: GenerationContractReadiness;
  format?: ProjectFormat;
  setting?: GenerationContractSetting;
}

const projectContractSnapshotSchema: z.ZodType<ProjectContractSnapshot> = z.object({
  isStoryboardProject: z.boolean(),
  format: z.enum(projectFormats).optional(),
  setting: generationContractSettingSchema.optional(),
  readiness: generationContractReadinessSchema,
});

export interface ProjectReadContractRequestPayload {
  [key: string]: never;
}

export const projectReadContractRequestPayloadSchema: z.ZodType<ProjectReadContractRequestPayload> =
  z.object({});

export const projectReadContractResponsePayloadSchema: z.ZodType<ProjectContractSnapshot> =
  projectContractSnapshotSchema;

export interface ProjectUpdateContractRequestPayload {
  genre?: string;
  audience?: string;
  pov?: PointOfView | null;
  composition?: CompositionKind | null;
  povCharacters?: string[];
  episodeCount?: number;
  targetWordCount?: null | number;
  prohibitions?: string[];
  styleConstraints?: string[];
  qualityCriteria?: string[];
}

export const projectUpdateContractRequestPayloadSchema: z.ZodType<ProjectUpdateContractRequestPayload> =
  z.object({
    genre: z.string().trim().optional(),
    audience: z.string().trim().optional(),
    pov: z.enum(pointOfViews).nullable().optional(),
    composition: z.enum(compositionKinds).nullable().optional(),
    povCharacters: z.array(z.string()).optional(),
    episodeCount: z.number().int().positive().optional(),
    targetWordCount: z.number().int().positive().nullable().optional(),
    prohibitions: z.array(z.string()).optional(),
    styleConstraints: z.array(z.string()).optional(),
    qualityCriteria: z.array(z.string()).optional(),
  });

export const projectUpdateContractResponsePayloadSchema: z.ZodType<ProjectContractSnapshot> =
  projectContractSnapshotSchema;

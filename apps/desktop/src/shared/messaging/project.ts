import { z } from 'zod';

import { contractFieldKeys, pointOfViews, projectFormats } from '@storyboard/story-format';

const generationContractReadinessSchema = z.object({
  isReady: z.boolean(),
  missing: z.array(z.enum(contractFieldKeys)),
  warnings: z.array(z.string()),
});

const generationContractSettingSchema = z.object({
  genre: z.string().optional(),
  audience: z.string().optional(),
  pov: z.enum(pointOfViews).optional(),
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
  targetWordCount: z.number().int().positive().nullable().optional(),
  prohibitions: z.array(z.string()).optional(),
  styleConstraints: z.array(z.string()).optional(),
  qualityCriteria: z.array(z.string()).optional(),
});

export const projectUpdateContractResponsePayloadSchema = projectContractSnapshotSchema;

import { z } from 'zod';

import profileData from './modelProfiles.params.json';

import { modelProfileKnobIds } from '#model/contracts/generationParameters';

export interface ModelMeasurement {
  date: string;
  workspace: string;
  sceneTarget: number;
  runs: number;
  reach: number;
  expansionRatio?: number;
  sections?: number;
  skeletonRatioCandidates?: string;
  auc?: number;
  recalled?: number;
  judge?: string;
  notes?: string;
}

const measurementSchema: z.ZodType<ModelMeasurement> = z.object({
  date: z.string().min(1),
  workspace: z.string().min(1),
  sceneTarget: z.number().int().positive(),
  runs: z.number().int().positive(),
  reach: z.number().positive(),
  expansionRatio: z.number().positive().optional(),
  sections: z.number().int().positive().optional(),
  skeletonRatioCandidates: z.string().optional(),
  auc: z.number().min(0).max(1).optional(),
  recalled: z.number().nonnegative().optional(),
  judge: z.string().optional(),
  notes: z.string().optional(),
});

export interface ModelProfile {
  readonly knobs: Readonly<Record<string, number>>;
  readonly measured?: ModelMeasurement;
}

const modelProfileSchema: z.ZodType<ModelProfile> = z
  .object({ measured: measurementSchema.optional() })
  .catchall(z.number())
  .superRefine((profile, context) => {
    for (const key of Object.keys(profile)) {
      if (key !== 'measured' && !modelProfileKnobIds.includes(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `모델 프로필이 모르는 손잡이를 담고 있습니다: ${key}`,
        });
      }
    }
  })
  .transform(
    ({ measured, ...knobs }): ModelProfile => ({
      knobs: knobs as Record<string, number>,
      ...(measured === undefined ? {} : { measured }),
    }),
  );

interface ModelProfiles {
  [key: string]: ModelProfile;
}

const modelProfilesSchema: z.ZodType<ModelProfiles> = z.record(z.string(), modelProfileSchema);

const modelProfiles: Record<string, ModelProfile> = modelProfilesSchema.parse(profileData);

export function modelProfileKey(providerId: string, model: string | undefined): string {
  return `${providerId}:${model ?? ''}`;
}

export function findModelProfile(
  providerId: string,
  model: string | undefined,
): ModelProfile | undefined {
  return modelProfiles[modelProfileKey(providerId, model)];
}

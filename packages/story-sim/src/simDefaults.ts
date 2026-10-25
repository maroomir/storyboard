import { z } from 'zod';

import defaultsData from './simDefaults.params.json';

const positiveInt: z.ZodNumber = z.number().int().positive();

export interface SimDefaults {
  panel: { commonReaderCount: number; engagementScaleMax: number; quoteRetryLimit: number };
  run: { repeats: number; sceneCount: number };
}

const simDefaultsSchema: z.ZodType<SimDefaults> = z.object({
  panel: z.object({
    commonReaderCount: positiveInt,
    engagementScaleMax: positiveInt,
    quoteRetryLimit: z.number().int().nonnegative(),
  }),
  run: z.object({
    repeats: positiveInt,
    sceneCount: positiveInt,
  }),
});

export const simDefaults: SimDefaults = simDefaultsSchema.parse(defaultsData);

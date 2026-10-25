import { z } from 'zod';

import { pointOfViews, type PointOfView } from '#model/format/project';

const optionalText: z.ZodPreprocess<z.ZodCatch<z.ZodOptional<z.ZodString>>> = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional().catch(undefined),
);

const textList: z.ZodType<string[]> = z
  .preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : [],
    z.array(z.string().trim().min(1)),
  )
  .optional()
  .transform((value) => value ?? []);

interface NoteSynthesisPayloadSetting {
  genre?: string;
  audience?: string;
  concept?: string;
  description?: string;
  pov?: PointOfView;
}

interface NoteSynthesisPayloadSynopsis {
  mainConflicts: string[];
  styleRules: string[];
  logline?: string;
  genrePromise?: string;
  ending?: string;
  theme?: string;
  tone?: string;
}

interface NoteSynthesisPayload {
  setting: NoteSynthesisPayloadSetting;
  synopsis: NoteSynthesisPayloadSynopsis;
}

const noteSynthesisSchema: z.ZodType<NoteSynthesisPayload> = z.object({
  setting: z
    .object({
      genre: optionalText,
      audience: optionalText,
      concept: optionalText,
      description: optionalText,
      pov: z.preprocess(
        (value) => ((pointOfViews as readonly unknown[]).includes(value) ? value : undefined),
        z.enum(pointOfViews).optional(),
      ),
    })
    .catch({}),
  synopsis: z
    .object({
      logline: optionalText,
      genrePromise: optionalText,
      mainConflicts: textList,
      ending: optionalText,
      theme: optionalText,
      tone: optionalText,
      styleRules: textList,
    })
    .catch({ mainConflicts: [], styleRules: [] }),
});

export interface NoteSynthesisSetting {
  readonly genre?: string;
  readonly audience?: string;
  readonly concept?: string;
  readonly description?: string;
  readonly pov?: PointOfView;
}

export interface NoteSynthesisSynopsis {
  readonly logline?: string;
  readonly genrePromise?: string;
  readonly mainConflicts: readonly string[];
  readonly ending?: string;
  readonly theme?: string;
  readonly tone?: string;
  readonly styleRules: readonly string[];
}

export interface NoteSynthesis {
  readonly setting: NoteSynthesisSetting;
  readonly synopsis: NoteSynthesisSynopsis;
}

export const emptyNoteSynthesis: NoteSynthesis = {
  setting: {},
  synopsis: { mainConflicts: [], styleRules: [] },
};

export function coerceNoteSynthesis(value: Record<string, unknown> | null): NoteSynthesis {
  const parsed: z.ZodSafeParseResult<NoteSynthesisPayload> = noteSynthesisSchema.safeParse({
    setting: value?.setting ?? {},
    synopsis: value?.synopsis ?? {},
  });

  return parsed.success ? parsed.data : emptyNoteSynthesis;
}

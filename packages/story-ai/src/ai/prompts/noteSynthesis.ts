import { z } from 'zod';

import { pointOfViews, type PointOfView } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional().catch(undefined),
);

// zod 4 는 빠진 키를 preprocess 에 넘기지 않으므로, 목록은 optional 로 받고 빈 배열로 채운다.
const textList = z
  .preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : [],
    z.array(z.string().trim().min(1)),
  )
  .optional()
  .transform((value) => value ?? []);

const noteSynthesisSchema = z.object({
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

export const NoteSynthesisPrompt = {
  config: promptTuning('noteSynthesis'),
  build(
    premise: readonly string[],
    castNames: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('noteSynthesis', variant, {
      view: {
        pointOfViewList: pointOfViews.join(', '),
        premise: premise.map((line) => `- ${line}`).join('\n'),
        hasCast: castNames.length > 0,
        cast: castNames.join(', '),
      },
    });
  },
} as const;

export function coerceNoteSynthesis(value: Record<string, unknown> | null): NoteSynthesis {
  const parsed = noteSynthesisSchema.safeParse({
    setting: value?.setting ?? {},
    synopsis: value?.synopsis ?? {},
  });

  return parsed.success ? parsed.data : emptyNoteSynthesis;
}

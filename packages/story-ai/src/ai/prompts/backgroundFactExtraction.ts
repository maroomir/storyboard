import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { coerceOptionalString, coerceStringList } from '@storyboard/story-model';

export interface BackgroundFactExtraction {
  readonly description: readonly string[];
  readonly senses: readonly string[];
  readonly time?: string;
  readonly weather?: string;
  readonly characterNames: readonly string[];
}

export const BackgroundFactExtractionPrompt: PromptModule<
  [body: string, backgroundName: string, variant?: PromptVariantId]
> = {
  config: promptTuning('backgroundFactExtraction'),
  build(
    body: string,
    backgroundName: string,
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('backgroundFactExtraction', variant, { view: { body, backgroundName } });
  },
};

export function coerceBackgroundFactExtraction(
  value: Record<string, unknown> | null,
): BackgroundFactExtraction {
  if (value === null) {
    return { description: [], senses: [], characterNames: [] };
  }

  return {
    description: coerceStringList(value.description),
    senses: coerceStringList(value.senses),
    characterNames: coerceStringList(value.characterNames),
    ...(coerceOptionalString(value.time) ? { time: coerceOptionalString(value.time) } : {}),
    ...(coerceOptionalString(value.weather)
      ? { weather: coerceOptionalString(value.weather) }
      : {}),
  };
}

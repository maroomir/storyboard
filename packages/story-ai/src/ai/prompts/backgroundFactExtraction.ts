import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface BackgroundFactExtraction {
  readonly description: readonly string[];
  readonly senses: readonly string[];
  readonly time?: string;
  readonly weather?: string;
  readonly characterNames: readonly string[];
}

export const BackgroundFactExtractionPrompt = {
  config: promptTuning('backgroundFactExtraction'),
  build(
    body: string,
    backgroundName: string,
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('backgroundFactExtraction', variant, { view: { body, backgroundName } });
  },
} as const;

function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];

  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      result.push(entry.trim());
    }
  }

  return result;
}

function coerceOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

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

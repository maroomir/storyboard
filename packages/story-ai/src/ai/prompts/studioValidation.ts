import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import type { PromptArtifact } from './types';

export interface StudioValidationPromptInput {
  readonly entityLabel: string;
  readonly context: string;
  readonly summary: string;
  readonly diff: string;
}

export const StudioValidationPrompt = {
  config: promptTuning('studioValidation'),
  build(input: StudioValidationPromptInput): PromptArtifact {
    return renderPrompt('studioValidation', 'generic', {
      view: {
        entityLabel: input.entityLabel,
        context: input.context,
        summary: input.summary,
        diff: input.diff,
      },
    });
  },
} as const;

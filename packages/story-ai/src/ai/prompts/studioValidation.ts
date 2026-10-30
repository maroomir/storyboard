import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import type { PromptArtifact, PromptModule } from '#ai/ai/prompts/types';

export interface StudioValidationPromptInput {
  readonly entityLabel: string;
  readonly context: string;
  readonly summary: string;
  readonly diff: string;
}

export const StudioValidationPrompt: PromptModule<[input: StudioValidationPromptInput]> = {
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
};

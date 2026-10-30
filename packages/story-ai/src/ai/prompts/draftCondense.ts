import type { ProjectFormat } from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface DraftCondenseInput {
  readonly body: string;
  readonly format: ProjectFormat;
  readonly targetLength: number;
  readonly intent?: string;
  readonly facts?: readonly string[];
  readonly characterCards?: readonly string[];
}

export const DraftCondensePrompt: PromptModule<
  [input: DraftCondenseInput, variant?: PromptVariantId]
> = {
  config: promptTuning('draftCondense'),
  build(input: DraftCondenseInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('draftCondense', variant, {
      view: {
        targetLength: input.targetLength,
        body: input.body,
        intent: input.intent?.trim() ? input.intent : undefined,
        facts: input.facts && input.facts.length > 0 ? input.facts.join('\n') : undefined,
        characterCards:
          input.characterCards && input.characterCards.length > 0
            ? input.characterCards.join('\n\n')
            : undefined,
      },
    });
  },
};

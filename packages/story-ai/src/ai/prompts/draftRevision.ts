import type { ProjectFormat } from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface DraftRevisionInput {
  readonly body: string;
  readonly format: ProjectFormat;
  readonly instructions: readonly string[];
  readonly intent: string;
  readonly facts: readonly string[];
  readonly characterCards?: readonly string[];
}

export const DraftRevisionPrompt: PromptModule<
  [input: DraftRevisionInput, variant?: PromptVariantId]
> = {
  config: promptTuning('draftRevision'),
  build(input: DraftRevisionInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('draftRevision', variant, {
      view: {
        instructions: input.instructions,
        intent: input.intent.trim().length > 0 ? input.intent : undefined,
        facts: input.facts.length > 0 ? input.facts.join('\n') : undefined,
        characterCards:
          input.characterCards && input.characterCards.length > 0
            ? input.characterCards.join('\n\n')
            : undefined,
        body: input.body,
      },
    });
  },
};

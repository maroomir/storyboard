import type { ProjectFormat } from '@storyboard/story-format';
import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

export interface DraftCondenseInput {
  readonly body: string;
  readonly format: ProjectFormat;
  readonly targetLength: number;
  readonly intent?: string;
  readonly facts?: readonly string[];
  readonly characterCards?: readonly string[];
}

export const DraftCondensePrompt = {
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
} as const;

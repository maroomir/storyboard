import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import type { PromptArtifact, PromptModule } from '#ai/ai/prompts/types';

export interface StudioCardAuditPromptInput {
  readonly entityLabel: string;
  readonly cardText: string;
  readonly context: string;
}

export const StudioCardAuditPrompt: PromptModule<[input: StudioCardAuditPromptInput]> = {
  config: promptTuning('studioCardAudit'),
  build(input: StudioCardAuditPromptInput): PromptArtifact {
    return renderPrompt('studioCardAudit', 'generic', {
      view: {
        entityLabel: input.entityLabel,
        cardText: input.cardText,
        context: input.context,
      },
    });
  },
};

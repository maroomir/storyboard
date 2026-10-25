import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import type { PromptArtifact, PromptModule } from './types';

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

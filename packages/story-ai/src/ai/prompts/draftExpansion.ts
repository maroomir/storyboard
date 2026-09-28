import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface DraftExpansionPromptContext {
  readonly activeCharacter?: string;
  readonly background?: string;
}

export const DraftExpansionPrompt = {
  config: promptTuning('draftExpansion'),
  build(
    selection: string,
    context: DraftExpansionPromptContext = {},
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('draftExpansion', variant, {
      view: {
        activeCharacter: context.activeCharacter,
        background: context.background,
        hasContext: Boolean(context.activeCharacter || context.background),
        selection,
      },
    });
  },
} as const;

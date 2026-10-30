import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface DraftExpansionPromptContext {
  readonly activeCharacter?: string;
  readonly background?: string;
}

export const DraftExpansionPrompt: PromptModule<
  [selection: string, context?: DraftExpansionPromptContext, variant?: PromptVariantId]
> = {
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
};

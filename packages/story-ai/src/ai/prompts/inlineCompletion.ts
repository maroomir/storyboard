import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface InlineCompletionPromptContext {
  readonly activeCharacter?: string;
  readonly background?: string;
  readonly sceneIntent?: string;
}

export const InlineCompletionPrompt: PromptModule<
  [prefix: string, context?: InlineCompletionPromptContext, variant?: PromptVariantId]
> = {
  config: promptTuning('inlineCompletion'),
  build(
    prefix: string,
    context: InlineCompletionPromptContext = {},
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('inlineCompletion', variant, {
      view: {
        sceneIntent: context.sceneIntent,
        activeCharacter: context.activeCharacter,
        background: context.background,
        hasContext: Boolean(context.activeCharacter || context.background),
        prefix,
      },
    });
  },
};

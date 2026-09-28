import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface InlineCompletionPromptContext {
  readonly activeCharacter?: string;
  readonly background?: string;
  readonly sceneIntent?: string;
}

export const InlineCompletionPrompt = {
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
} as const;

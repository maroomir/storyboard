import { pointOfViews } from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export const NoteSynthesisPrompt: PromptModule<
  [premise: readonly string[], castNames: readonly string[], variant?: PromptVariantId]
> = {
  config: promptTuning('noteSynthesis'),
  build(
    premise: readonly string[],
    castNames: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('noteSynthesis', variant, {
      view: {
        pointOfViewList: pointOfViews.join(', '),
        premise: premise.map((line) => `- ${line}`).join('\n'),
        hasCast: castNames.length > 0,
        cast: castNames.join(', '),
      },
    });
  },
};

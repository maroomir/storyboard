import { pointOfViews } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

export const NoteSynthesisPrompt = {
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
} as const;

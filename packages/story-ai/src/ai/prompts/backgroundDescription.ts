import type { Background } from '@storyboard/story-model';
import { joinCardText } from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export const BackgroundDescriptionPrompt: PromptModule<
  [background: Background, variant?: PromptVariantId, recentExcerpt?: string]
> = {
  config: promptTuning('backgroundDescription'),
  build(
    background: Background,
    variant: PromptVariantId = 'generic',
    recentExcerpt?: string,
  ): PromptArtifact {
    return renderPrompt('backgroundDescription', variant, {
      view: {
        name: background.name,
        type: background.type,
        description: joinCardText(background.description),
        time: background.time,
        weather: background.weather,
        senses: joinCardText(background.senses),
        tags:
          background.tags && background.tags.length > 0 ? background.tags.join(', ') : undefined,
        recentExcerpt,
      },
    });
  },
};

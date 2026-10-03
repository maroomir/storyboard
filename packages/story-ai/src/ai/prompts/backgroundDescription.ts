import type { Background } from '@storyboard/story-model';
import { joinCardText } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const BackgroundDescriptionPrompt = {
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
} as const;

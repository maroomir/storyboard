import type { ProjectFormat } from '@storyboard/story-model';
import {
  craftContractLines,
  narrativeStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const GenreFormattingPrompt = {
  config: promptTuning('genreFormatting'),
  build(
    dialogue: string,
    format: ProjectFormat,
    variant: PromptVariantId = 'generic',
    style?: StyleDirective,
  ): PromptArtifact {
    return renderPrompt('genreFormatting', variant, {
      view: {
        dialogue,
        format,
        formatIs: { [format]: true },
        styleLines: [...narrativeStyleLines(style), ...craftContractLines(style?.craftContract)],
      },
    });
  },
} as const;

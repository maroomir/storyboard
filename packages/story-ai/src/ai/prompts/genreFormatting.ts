import type { ProjectFormat } from '@storyboard/story-model';
import {
  craftContractLines,
  narrativeStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export const GenreFormattingPrompt: PromptModule<
  [dialogue: string, format: ProjectFormat, variant?: PromptVariantId, style?: StyleDirective]
> = {
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
};

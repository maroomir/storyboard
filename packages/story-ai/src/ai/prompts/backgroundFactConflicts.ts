import type { Background } from '@storyboard/story-model';
import { listBackgroundFactLines } from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export const BackgroundFactConflictsPrompt: PromptModule<
  [background: Background, variant?: PromptVariantId]
> = {
  config: promptTuning('backgroundFactConflicts'),
  build(background: Background, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('backgroundFactConflicts', variant, {
      view: { name: background.name, lines: listBackgroundFactLines(background) },
    });
  },
};

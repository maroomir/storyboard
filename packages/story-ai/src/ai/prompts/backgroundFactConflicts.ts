import type { Background } from '@storyboard/story-model';
import { listBackgroundFactLines } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';

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

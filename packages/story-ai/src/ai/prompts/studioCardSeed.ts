import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import type { PromptArtifact, PromptModule } from './types';

export const StudioCardSeedPrompt: PromptModule<[description: string]> = {
  config: promptTuning('studioCardSeed'),
  build(description: string): PromptArtifact {
    return renderPrompt('studioCardSeed', 'generic', { view: { description } });
  },
};

import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import type { PromptArtifact } from './types';

export const StudioCardSeedPrompt = {
  config: promptTuning('studioCardSeed'),
  build(description: string): PromptArtifact {
    return renderPrompt('studioCardSeed', 'generic', { view: { description } });
  },
} as const;

import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import type { PromptArtifact, PromptModule } from '#ai/ai/prompts/types';

export const StudioCardSeedPrompt: PromptModule<[description: string]> = {
  config: promptTuning('studioCardSeed'),
  build(description: string): PromptArtifact {
    return renderPrompt('studioCardSeed', 'generic', { view: { description } });
  },
};

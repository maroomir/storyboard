import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const FactExtractionPrompt: PromptModule<
  [body: string, characterName: string, variant?: PromptVariantId]
> = {
  config: promptTuning('factExtraction'),
  build(body: string, characterName: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('factExtraction', variant, { view: { body, characterName } });
  },
};

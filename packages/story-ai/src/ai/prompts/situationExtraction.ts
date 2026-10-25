import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';

export const SituationExtractionPrompt: PromptModule<[input: string, variant?: PromptVariantId]> = {
  config: promptTuning('situationExtraction'),
  build(input: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('situationExtraction', variant, { view: { input } });
  },
};

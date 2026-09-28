import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

export const SituationExtractionPrompt = {
  config: promptTuning('situationExtraction'),
  build(input: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('situationExtraction', variant, { view: { input } });
  },
} as const;

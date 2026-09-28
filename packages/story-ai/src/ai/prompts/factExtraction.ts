import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const FactExtractionPrompt = {
  config: promptTuning('factExtraction'),
  build(body: string, characterName: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('factExtraction', variant, { view: { body, characterName } });
  },
} as const;

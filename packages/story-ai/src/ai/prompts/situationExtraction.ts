import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export const SituationExtractionPrompt: PromptModule<[input: string, variant?: PromptVariantId]> = {
  config: promptTuning('situationExtraction'),
  build(input: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('situationExtraction', variant, { view: { input } });
  },
};

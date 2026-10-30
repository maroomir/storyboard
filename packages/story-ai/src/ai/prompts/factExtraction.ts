import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export const FactExtractionPrompt: PromptModule<
  [body: string, characterName: string, variant?: PromptVariantId]
> = {
  config: promptTuning('factExtraction'),
  build(body: string, characterName: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('factExtraction', variant, { view: { body, characterName } });
  },
};

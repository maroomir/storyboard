import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export const GrammarCheckPrompt: PromptModule<[body: string, variant?: PromptVariantId]> = {
  config: promptTuning('grammarCheck'),
  build(body: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('grammarCheck', variant, { view: { body } });
  },
};

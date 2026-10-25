import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';

export const GrammarCheckPrompt: PromptModule<[body: string, variant?: PromptVariantId]> = {
  config: promptTuning('grammarCheck'),
  build(body: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('grammarCheck', variant, { view: { body } });
  },
};

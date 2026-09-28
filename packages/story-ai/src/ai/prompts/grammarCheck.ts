import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

export const GrammarCheckPrompt = {
  config: promptTuning('grammarCheck'),
  build(body: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('grammarCheck', variant, { view: { body } });
  },
} as const;

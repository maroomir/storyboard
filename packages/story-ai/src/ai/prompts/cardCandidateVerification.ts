import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const CardCandidateVerificationPrompt = {
  config: promptTuning('cardCandidateVerification'),
  build(
    body: string,
    characterName: string,
    statements: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    const numbered = statements.map((statement, index) => `${index}. ${statement}`).join('\n');
    return renderPrompt('cardCandidateVerification', variant, {
      view: { body, characterName, numbered },
    });
  },
} as const;

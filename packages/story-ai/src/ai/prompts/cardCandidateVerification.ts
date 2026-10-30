import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export const CardCandidateVerificationPrompt: PromptModule<
  [body: string, characterName: string, statements: readonly string[], variant?: PromptVariantId]
> = {
  config: promptTuning('cardCandidateVerification'),
  build(
    body: string,
    characterName: string,
    statements: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    const numbered: string = statements
      .map((statement, index) => `${index}. ${statement}`)
      .join('\n');
    return renderPrompt('cardCandidateVerification', variant, {
      view: { body, characterName, numbered },
    });
  },
};

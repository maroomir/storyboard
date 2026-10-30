import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export const ContinuityCheckPrompt: PromptModule<
  [body: string, facts: readonly string[], variant?: PromptVariantId, hasSceneMarkers?: boolean]
> = {
  config: promptTuning('continuityCheck'),
  build(
    body: string,
    facts: readonly string[],
    variant: PromptVariantId = 'generic',
    hasSceneMarkers: boolean = false,
  ): PromptArtifact {
    return renderPrompt('continuityCheck', variant, {
      view: { body, facts: facts.join('\n'), hasSceneMarkers },
    });
  },
};

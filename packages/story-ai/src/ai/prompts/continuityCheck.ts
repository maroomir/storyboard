import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

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

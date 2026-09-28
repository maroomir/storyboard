import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const ContinuityCheckPrompt = {
  config: promptTuning('continuityCheck'),
  build(
    body: string,
    facts: readonly string[],
    variant: PromptVariantId = 'generic',
    hasSceneMarkers = false,
  ): PromptArtifact {
    // The final review checks a whole assembled volume, so each issue has to name the scene it came
    // from or it cannot be routed back to a draft file.
    return renderPrompt('continuityCheck', variant, {
      view: { body, facts: facts.join('\n'), hasSceneMarkers },
    });
  },
} as const;

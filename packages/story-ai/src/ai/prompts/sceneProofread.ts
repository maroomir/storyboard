import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface SceneProofreadInput {
  readonly text: string;
  readonly suspects: readonly string[];
}

export const SceneProofreadPrompt: PromptModule<
  [input: SceneProofreadInput, variant?: PromptVariantId]
> = {
  config: promptTuning('sceneProofread'),
  build(input: SceneProofreadInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('sceneProofread', variant, {
      view: {
        hasSuspects: input.suspects.length > 0,
        suspects: input.suspects,
        text: input.text,
      },
    });
  },
};

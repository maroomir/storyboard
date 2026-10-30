import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface SceneBeatsPromptInput {
  readonly sceneBody: string;
  readonly summary?: string;
  readonly grounding: readonly string[];
  readonly characterNames: readonly string[];
  readonly beatCount: number;
}

export const SceneBeatsPrompt: PromptModule<
  [input: SceneBeatsPromptInput, variant?: PromptVariantId]
> = {
  config: promptTuning('sceneBeats'),
  build(input: SceneBeatsPromptInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const hasSummary: boolean = input.summary !== undefined && input.summary.trim().length > 0;

    return renderPrompt('sceneBeats', variant, {
      view: {
        beatCount: input.beatCount,
        sceneBody: input.sceneBody,
        summary: hasSummary ? input.summary?.trim() : undefined,
        hasCharacterNames: input.characterNames.length > 0,
        characterNames: input.characterNames.join(', '),
        grounding: input.grounding.join('\n'),
        xsMaterial: [input.sceneBody, input.summary].filter(Boolean).join('\n\n'),
      },
    });
  },
};

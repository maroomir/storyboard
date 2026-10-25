import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';
import type { CharacterRef } from '@storyboard/story-model';

export interface SceneDialogueAttributionInput {
  readonly skeleton: string;
  readonly lines: readonly string[];
  readonly candidates: readonly CharacterRef[];
}

export const SceneDialogueAttributionPrompt: PromptModule<
  [input: SceneDialogueAttributionInput, variant?: PromptVariantId]
> = {
  config: promptTuning('sceneDialogueAttribution'),
  build(
    input: SceneDialogueAttributionInput,
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('sceneDialogueAttribution', variant, {
      view: {
        candidates: input.candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        })),
        skeleton: input.skeleton,
        numberedLines: input.lines.map((line, offset) => `${offset + 1}. ${line}`).join('\n'),
      },
    });
  },
};

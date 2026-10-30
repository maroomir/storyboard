import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface StoryStateUpdateInput {
  readonly sceneTitle: string;
  readonly draftBody: string;
  readonly previousState?: string;
  readonly characterNames?: readonly string[];
}

export const StoryStateUpdatePrompt: PromptModule<
  [input: StoryStateUpdateInput, variant?: PromptVariantId]
> = {
  config: promptTuning('storyStateUpdate'),
  build(input: StoryStateUpdateInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const characterNames: readonly string[] = input.characterNames ?? [];

    return renderPrompt('storyStateUpdate', variant, {
      view: {
        hasCharacterNames: characterNames.length > 0,
        characterNames: characterNames.join(', '),
        previousState: input.previousState,
        sceneTitle: input.sceneTitle,
        draftBody: input.draftBody,
      },
    });
  },
};

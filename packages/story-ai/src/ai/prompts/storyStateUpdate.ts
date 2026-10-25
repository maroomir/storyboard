import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';

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

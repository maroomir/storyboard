import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

export interface StoryStateUpdateInput {
  readonly sceneTitle: string;
  readonly draftBody: string;
  readonly previousState?: string;
}

export const StoryStateUpdatePrompt = {
  config: promptTuning('storyStateUpdate'),
  build(input: StoryStateUpdateInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('storyStateUpdate', variant, {
      view: {
        previousState: input.previousState,
        sceneTitle: input.sceneTitle,
        draftBody: input.draftBody,
      },
    });
  },
} as const;

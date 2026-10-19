import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

export interface StoryStateUpdateInput {
  readonly sceneTitle: string;
  readonly draftBody: string;
  readonly previousState?: string;
  // 목격자 이름을 이 목록의 표기로 받기 위한 씬 인물들. «이름» 또는 «이름 (별칭: …)».
  readonly characterNames?: readonly string[];
}

export const StoryStateUpdatePrompt = {
  config: promptTuning('storyStateUpdate'),
  build(input: StoryStateUpdateInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const characterNames = input.characterNames ?? [];

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
} as const;

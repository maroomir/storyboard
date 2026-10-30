import {
  describeNarration,
  type NarrationDirective,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface DraftCritiqueInput {
  readonly body: string;
  readonly intent: string;
  readonly characters: readonly string[];
  readonly characterCards?: readonly string[];
  readonly facts: readonly string[];
  readonly styleConstraints?: readonly string[];
  readonly qualityCriteria?: readonly string[];
  readonly styleDirective?: StyleDirective;
  readonly hasSceneMarkers?: boolean;
}

export const DraftCritiquePrompt: PromptModule<
  [input: DraftCritiqueInput, variant?: PromptVariantId]
> = {
  config: promptTuning('draftCritique'),
  build(input: DraftCritiqueInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const narration: NarrationDirective | undefined = input.styleDirective?.narration;

    return renderPrompt('draftCritique', variant, {
      view: {
        hasSceneMarkers: input.hasSceneMarkers === true,
        intent: input.intent.trim().length > 0 ? input.intent : undefined,
        characters: input.characters.join(', '),
        facts: input.facts.join('\n'),
        styleConstraints: input.styleConstraints?.join('\n'),
        narration: narration ? describeNarration(narration) : undefined,
        narratorVoice: narration?.voice?.join('\n'),
        genre: input.styleDirective?.genre,
        relationStage: input.styleDirective?.relationStage,
        qualityCriteria: input.qualityCriteria?.join('\n'),
        characterCards: input.characterCards?.join('\n\n'),
        body: input.body,
      },
    });
  },
};

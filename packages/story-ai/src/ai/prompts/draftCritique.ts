import { describeNarration, type StyleDirective } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface DraftCritiqueInput {
  readonly body: string;
  readonly intent: string;
  readonly characters: readonly string[];
  readonly characterCards?: readonly string[];
  readonly facts: readonly string[];
  readonly styleConstraints?: readonly string[];
  readonly qualityCriteria?: readonly string[];
  readonly styleDirective?: StyleDirective;
  // Set when the body is an assembled volume carrying `<!-- scene: <stem> -->` markers, so each
  // issue can name the scene it came from and be routed back to a draft file.
  readonly hasSceneMarkers?: boolean;
}

export const DraftCritiquePrompt = {
  config: promptTuning('draftCritique'),
  build(input: DraftCritiqueInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const narration = input.styleDirective?.narration;

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
} as const;

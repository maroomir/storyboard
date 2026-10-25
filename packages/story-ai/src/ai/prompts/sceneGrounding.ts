import { sceneGroundingFieldLabels, type SceneGroundingFieldKey } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneGroundingPromptInput {
  readonly sceneBody: string;
  readonly missingFields: readonly SceneGroundingFieldKey[];
  readonly characterNames: readonly string[];
  readonly knownGrounding: readonly string[];
}

export const SceneGroundingPrompt: PromptModule<
  [input: SceneGroundingPromptInput, variant?: PromptVariantId]
> = {
  config: promptTuning('sceneGrounding'),
  build(input: SceneGroundingPromptInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('sceneGrounding', variant, {
      view: {
        requestedFields: input.missingFields.map((key, index) => ({
          key,
          label: sceneGroundingFieldLabels[key],
          isContinuation: index > 0,
          [key]: true,
        })),
        jsonShape: `{${input.missingFields.map((key) => `"${key}":""`).join(',')}}`,
        hasCharacterNames: input.characterNames.length > 0,
        characterNames: input.characterNames.join(', '),
        hasKnownGrounding: input.knownGrounding.length > 0,
        knownGrounding: input.knownGrounding.join('\n'),
        sceneBody: input.sceneBody,
      },
    });
  },
};

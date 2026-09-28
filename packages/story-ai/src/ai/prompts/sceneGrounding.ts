import { sceneGroundingFieldLabels, type SceneGroundingFieldKey } from '@storyboard/story-format';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneGroundingPromptInput {
  readonly sceneBody: string;
  readonly missingFields: readonly SceneGroundingFieldKey[];
  readonly characterNames: readonly string[];
  readonly knownGrounding: readonly string[];
}

export const SceneGroundingPrompt = {
  config: promptTuning('sceneGrounding'),
  build(input: SceneGroundingPromptInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('sceneGrounding', variant, {
      view: {
        // NOTE: 항목마다 자기 키 이름의 플래그를 켜서 리소스가 그 키의 안내 문구를 고른다.
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
} as const;

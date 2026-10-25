import {
  isSceneStructureListField,
  sceneSeedSectionLabels,
  type SceneStructureFieldKey,
} from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneStructurePromptInput {
  readonly sceneSummary: string;
  readonly missingFields: readonly SceneStructureFieldKey[];
  readonly knownFields: readonly string[];
}

export const SceneStructurePrompt: PromptModule<
  [input: SceneStructurePromptInput, variant?: PromptVariantId]
> = {
  config: promptTuning('sceneStructure'),
  build(input: SceneStructurePromptInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const responseShape: string = input.missingFields
      .map((key) => (isSceneStructureListField(key) ? `"${key}":[]` : `"${key}":""`))
      .join(',');

    return renderPrompt('sceneStructure', variant, {
      view: {
        requestedFields: input.missingFields.map((key, index) => ({
          key,
          label: sceneSeedSectionLabels[key],
          isContinuation: index > 0,
          [key]: true,
        })),
        responseShape: `{${responseShape}}`,
        hasKnownFields: input.knownFields.length > 0,
        knownFields: input.knownFields.join('\n'),
        sceneSummary: input.sceneSummary,
      },
    });
  },
};

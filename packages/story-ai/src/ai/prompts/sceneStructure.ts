import { sceneSeedSectionLabels } from '@storyboard/story-format';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export type SceneStructureFieldKey =
  | 'purpose'
  | 'conflict'
  | 'twist'
  | 'emotionalShift'
  | 'endState'
  | 'foreshadowing'
  | 'neededCanon';

export interface SceneStructurePromptInput {
  readonly sceneSummary: string;
  readonly missingFields: readonly SceneStructureFieldKey[];
  readonly knownFields: readonly string[];
}

const listFields: readonly SceneStructureFieldKey[] = ['foreshadowing', 'neededCanon'];

export const SceneStructurePrompt = {
  config: promptTuning('sceneStructure'),
  build(input: SceneStructurePromptInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const responseShape = input.missingFields
      .map((key) => (listFields.includes(key) ? `"${key}":[]` : `"${key}":""`))
      .join(',');

    return renderPrompt('sceneStructure', variant, {
      view: {
        // NOTE: 항목마다 자기 키 이름의 플래그를 켜서 리소스가 그 키의 안내 문구를 고른다.
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
} as const;

import {
  generationParameterCatalog,
  integerSettingDefault,
  sectionOutputLimitParameterId,
} from '@storyboard/story-model';
import { promptTuning, promptTuningKeys } from '@storyboard/story-ai';
import type { AiProviderId } from '@storyboard/story-model';
import type { PromptConfig, PromptTuningKey } from '@storyboard/story-ai';
import { generationParameterDefault } from '@storyboard/story-engine';

export type KnobId = string;

export type KnobKind = 'ratio' | 'count' | 'chars' | 'weight' | 'temperature' | 'tokens';

export type KnobApplyTarget = 'modelProfile' | 'pipelineDefault' | 'promptTuning';

export const sectionOutputLimitKnobId: string = sectionOutputLimitParameterId;

export interface KnobSpec {
  readonly id: KnobId;
  readonly promptKey?: PromptTuningKey;
  readonly promptField?: 'temperature' | 'maxTokens';
  readonly kind: KnobKind;
  readonly defaultValue: number;
  readonly bounds: { readonly min: number; readonly max: number };
  readonly honouredBy: 'all' | readonly AiProviderId[];
  readonly applyTarget: KnobApplyTarget;
  readonly note?: string;
}

const generationKnobs: readonly KnobSpec[] = generationParameterCatalog.map((definition) => ({
  id: definition.id,
  kind: definition.kind,
  defaultValue: generationParameterDefault(definition.id),
  bounds: definition.bounds,
  honouredBy: 'all',
  applyTarget: 'modelProfile',
}));

const promptKnobs: readonly KnobSpec[] = promptTuningKeys().flatMap((promptKey) => {
  const config: PromptConfig = promptTuning(promptKey);

  return [
    {
      id: `prompt.${promptKey}.temperature`,
      promptKey,
      promptField: 'temperature' as const,
      kind: 'temperature' as const,
      defaultValue: config.temperature,
      bounds: { min: 0, max: 2 },
      honouredBy: 'all' as const,
      applyTarget: 'promptTuning' as const,
    },
    {
      id: `prompt.${promptKey}.maxTokens`,
      promptKey,
      promptField: 'maxTokens' as const,
      kind: 'tokens' as const,
      defaultValue: config.maxTokens,
      bounds: {
        min: Math.max(32, Math.round(config.maxTokens / 4)),
        max: Math.min(64_000, config.maxTokens * 4),
      },
      honouredBy: 'all' as const,
      applyTarget: 'promptTuning' as const,
    },
  ];
});

export const knobRegistry: readonly KnobSpec[] = [
  ...generationKnobs,
  {
    id: sectionOutputLimitKnobId,
    kind: 'chars',
    defaultValue: integerSettingDefault(sectionOutputLimitKnobId),
    bounds: { min: 500, max: 20_000 },
    honouredBy: 'all',
    applyTarget: 'modelProfile',
  },
  ...promptKnobs,
];

export function isSectionOutputLimitKnob(knob: KnobSpec): boolean {
  return knob.id === sectionOutputLimitKnobId;
}

export function isPromptKnob(knob: KnobSpec): boolean {
  return knob.promptKey !== undefined;
}

export function findKnob(id: KnobId): KnobSpec | undefined {
  return knobRegistry.find((knob) => knob.id === id);
}

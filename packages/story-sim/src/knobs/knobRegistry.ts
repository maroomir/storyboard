import {
  generationParameterCatalog,
  integerSettingDefault,
  sectionOutputLimitParameterId,
} from '@storyboard/story-model';
import { promptTuning, promptTuningKeys } from '@storyboard/story-ai';
import type { AiProviderId } from '@storyboard/story-model';
import type { PromptTuningKey } from '@storyboard/story-ai';
import { generationParameterDefault } from '@storyboard/story-engine';

// 스윕이 흔들 수 있는 손잡이 목록. 이름·단위·범위는 story-ai 의 생성 카탈로그가, 기본값은
// pipelineDefaults 가 갖는다 — 여기 다시 적으면 두 곳이 갈라진다.

export type KnobId = string;

export type KnobKind = 'ratio' | 'count' | 'chars' | 'weight' | 'temperature' | 'tokens';

// 되쓰기 대상. 한 모델에서만 잰 값은 공유 기본값이 아니라 모델 프로필로 가야 한다.
export type KnobApplyTarget = 'modelProfile' | 'pipelineDefault' | 'promptTuning';

// 구간 상한만 pipelineDefaults 가 아니라 설정 카탈로그가 갖는다. 파이프라인 인자로도 tuning 이
// 아니라 따로 들어가므로, 손잡이 표에서도 한 칸을 따로 쓴다.
export const sectionOutputLimitKnobId = sectionOutputLimitParameterId;

export interface KnobSpec {
  readonly id: KnobId;
  // 프롬프트 손잡이만 채운다. 나머지는 id 그대로 파이프라인 tuning 에 들어간다.
  readonly promptKey?: PromptTuningKey;
  readonly promptField?: 'temperature' | 'maxTokens';
  readonly kind: KnobKind;
  readonly defaultValue: number;
  readonly bounds: { readonly min: number; readonly max: number };
  // 이 손잡이를 실제로 반영하는 프로바이더. 'all' 이 아니면 나머지에서는 스윕해도 아무것도 안 변한다.
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

// NOTE: 온도와 출력 상한은 프롬프트마다 따로 있다. 값의 출처는 프롬프트 리소스 파일의 머리말
// 하나뿐이라 여기서 기본값을 다시 적지 않는다. 씬 생성이 부르지 않는 프롬프트의 손잡이는 돌려도 아무것도
// 안 바뀌므로, 도달성 사전 조사가 그것을 걸러낸다.
const promptKnobs: readonly KnobSpec[] = promptTuningKeys().flatMap((promptKey) => {
  const config = promptTuning(promptKey);

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
      // 상한은 프롬프트마다 120에서 12,000까지 벌어져 있다. 한 가지 절대 범위를 씌우면 짧은
      // 프롬프트는 못 내리고 긴 프롬프트는 못 올리므로, 기본값을 기준으로 잡는다.
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
    // 실측상 7000 에서 1000 으로 내리면 도달률이 46% 오른다. 그 사이가 아직 공백이다.
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

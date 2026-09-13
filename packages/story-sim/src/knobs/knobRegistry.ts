import { integerSettingDefault, promptTuning, promptTuningKeys } from '@storyboard/story-ai';
import type { AiProviderId, PromptTuningKey } from '@storyboard/story-ai';
import { pipelineDefaults, sectionViolationKinds } from '@storyboard/story-pipeline';
import type { SceneGenerationTuning } from '@storyboard/story-pipeline';

// 스윕이 흔들 수 있는 손잡이 목록. 한 행이 하나이고, 값의 출처는 언제나 pipelineDefaults 다 —
// 기본값을 여기 다시 적으면 두 곳이 갈라진다.

export type KnobId = string;

export type KnobKind = 'ratio' | 'count' | 'chars' | 'weight' | 'temperature' | 'tokens';

// 되쓰기 대상. 한 모델에서만 잰 값은 공유 기본값이 아니라 모델 프로필로 가야 한다.
export type KnobApplyTarget = 'modelProfile' | 'pipelineDefault' | 'promptTuning';

// 구간 상한만 pipelineDefaults 가 아니라 설정 카탈로그가 갖는다. 파이프라인 인자로도 tuning 이
// 아니라 따로 들어가므로, 손잡이 표에서도 한 칸을 따로 쓴다.
export const sectionOutputLimitKnobId = 'draft.sectionOutputLimit';

export interface KnobSpec {
  readonly id: KnobId;
  // 파이프라인 손잡이면 tuningKey, 프롬프트 손잡이면 promptKey 가 채워진다. 둘은 배타적이다.
  readonly tuningKey?: keyof SceneGenerationTuning;
  readonly promptKey?: PromptTuningKey;
  readonly promptField?: 'temperature' | 'maxTokens';
  // violationWeights.* 만 채운다. 저울은 손잡이 하나가 아니라 여덟 칸이라 키를 따로 든다.
  readonly weightKind?: (typeof sectionViolationKinds)[number];
  readonly kind: KnobKind;
  readonly defaultValue: number;
  readonly bounds: { readonly min: number; readonly max: number };
  // 이 손잡이를 실제로 반영하는 프로바이더. 'all' 이 아니면 나머지에서는 스윕해도 아무것도 안 변한다.
  readonly honouredBy: 'all' | readonly AiProviderId[];
  readonly applyTarget: KnobApplyTarget;
  readonly note?: string;
}

function ratio(
  id: KnobId,
  tuningKey: keyof SceneGenerationTuning,
  defaultValue: number,
  note?: string,
): KnobSpec {
  return {
    id,
    tuningKey,
    kind: 'ratio',
    defaultValue,
    bounds: { min: 0.05, max: 1 },
    honouredBy: 'all',
    applyTarget: 'modelProfile',
    ...(note === undefined ? {} : { note }),
  };
}

function count(
  id: KnobId,
  tuningKey: keyof SceneGenerationTuning,
  defaultValue: number,
  bounds: { readonly min: number; readonly max: number },
  note?: string,
): KnobSpec {
  return {
    id,
    tuningKey,
    kind: 'count',
    defaultValue,
    bounds,
    honouredBy: 'all',
    applyTarget: 'modelProfile',
    ...(note === undefined ? {} : { note }),
  };
}

function chars(
  id: KnobId,
  tuningKey: keyof SceneGenerationTuning,
  defaultValue: number,
  bounds: { readonly min: number; readonly max: number },
): KnobSpec {
  return {
    id,
    tuningKey,
    kind: 'chars',
    defaultValue,
    bounds,
    honouredBy: 'all',
    applyTarget: 'modelProfile',
  };
}

const weightKnobs: readonly KnobSpec[] = sectionViolationKinds.map((kind) => ({
  id: `violationWeights.${kind}`,
  tuningKey: 'violationWeights' as const,
  weightKind: kind,
  kind: 'weight' as const,
  defaultValue: pipelineDefaults.violationWeights[kind],
  bounds: { min: 1, max: 10 },
  honouredBy: 'all' as const,
  applyTarget: 'modelProfile' as const,
}));

// NOTE: 온도와 출력 상한은 프롬프트마다 따로 있다. 값의 출처는 promptTuning.params.json 하나뿐이라
// 여기서 기본값을 다시 적지 않는다. 씬 생성이 부르지 않는 프롬프트의 손잡이는 돌려도 아무것도
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
  count('section.retryLimit', 'sectionRetryLimit', pipelineDefaults.section.retryLimit, {
    min: 0,
    max: 4,
  }),
  ratio(
    'section.minimumLengthRatio',
    'sectionMinimumLengthRatio',
    pipelineDefaults.section.minimumLengthRatio,
  ),
  chars(
    'section.repeatedRunWindow',
    'sectionRepeatedRunWindow',
    pipelineDefaults.section.repeatedRunWindow,
    { min: 20, max: 400 },
  ),
  chars(
    'section.repeatedRunLimit',
    'sectionRepeatedRunLimit',
    pipelineDefaults.section.repeatedRunLimit,
    { min: 50, max: 1200 },
  ),
  ratio('skeleton.lengthRatio', 'skeletonRatio', pipelineDefaults.skeleton.lengthRatio),
  count('skeleton.retryLimit', 'skeletonRetryLimit', pipelineDefaults.skeleton.retryLimit, {
    min: 0,
    max: 3,
  }),
  ratio(
    'skeleton.minimumLengthRatio',
    'skeletonMinimumLengthRatio',
    pipelineDefaults.skeleton.minimumLengthRatio,
  ),
  ratio(
    'dialogue.preservedRatio',
    'dialoguePreservedRatio',
    pipelineDefaults.dialogue.preservedRatio,
  ),
  count('dialogue.splitLimit', 'dialogueSplitLimit', pipelineDefaults.dialogue.splitLimit, {
    min: 1,
    max: 6,
  }),
  count(
    'dialogue.repeatedRunLimit',
    'dialogueRepeatedRunLimit',
    pipelineDefaults.dialogue.repeatedRunLimit,
    { min: 2, max: 8 },
  ),
  chars(
    'dialogue.minimumLineLength',
    'dialogueMinimumLineLength',
    pipelineDefaults.dialogue.minimumLineLength,
    { min: 2, max: 30 },
  ),
  chars(
    'dialogue.minimumQuotedLength',
    'dialogueMinimumQuotedLength',
    pipelineDefaults.dialogue.minimumQuotedLength,
    { min: 2, max: 30 },
  ),
  {
    ...count(
      'polish.lengthLimitRatio',
      'polishLengthLimitRatio',
      pipelineDefaults.polish.lengthLimitRatio,
      {
        min: 1,
        max: 5,
      },
    ),
    kind: 'ratio',
  },
  count('polish.retryLimit', 'polishRetryLimit', pipelineDefaults.polish.retryLimit, {
    min: 1,
    max: 4,
    // NOTE: 뼈대·구간은 attempt <= retryLimit 로 돌고 다듬기만 < 로 돈다. 같은 숫자가 호출을
    // 하나 덜 부르므로 두 계열의 재시도 한도를 나란히 비교하지 않는다.
  }),
  ratio('padding.paragraphRatio', 'paddingParagraphRatio', pipelineDefaults.padding.paragraphRatio),
  chars(
    'padding.paragraphMinimumLength',
    'paddingParagraphMinimumLength',
    pipelineDefaults.padding.paragraphMinimumLength,
    { min: 10, max: 200 },
  ),
  count('voiceSamples.limit', 'voiceSampleLimit', pipelineDefaults.voiceSamples.limit, {
    min: 1,
    max: 12,
  }),
  chars(
    'voiceSamples.minimumLength',
    'voiceSampleMinimumLength',
    pipelineDefaults.voiceSamples.minimumLength,
    { min: 2, max: 40 },
  ),
  chars(
    'voiceSamples.maximumLength',
    'voiceSampleMaximumLength',
    pipelineDefaults.voiceSamples.maximumLength,
    { min: 20, max: 200 },
  ),
  chars(
    'context.condensedMaxChars',
    'contextCondensedMaxChars',
    pipelineDefaults.context.condensedMaxChars,
    { min: 200, max: 8000 },
  ),
  ...weightKnobs,
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

export function findKnob(id: KnobId): KnobSpec | undefined {
  return knobRegistry.find((knob) => knob.id === id);
}

export function isPromptKnob(knob: KnobSpec): boolean {
  return knob.promptKey !== undefined;
}

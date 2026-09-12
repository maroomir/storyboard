import type { SceneGenerationTuningLike } from '@storyboard/story-ai';

import { pipelineDefaults } from './pipelineDefaults';

// NOTE: 위반 종류는 저울(violationWeights)의 키와 같아야 해서 이 파일이 갖는다. sceneSectionPlan 이
// 이 이름을 가져다 쓰면 손잡이 → 구간 계획 한 방향으로만 의존한다.
export const sectionViolationKinds = [
  'cast',
  'foreign-script',
  'lost-dialogue',
  'too-short',
  'too-long',
  'repeats-previous',
  'repetition',
  'dialogue-count',
] as const;

export type SectionViolationKind = (typeof sectionViolationKinds)[number];

export type ViolationWeights = Readonly<Record<SectionViolationKind, number>>;

// NOTE: 값은 호스트가 모델 프로필에서 꺼내 넣는다. 파이프라인은 어느 모델인지 알 필요가 없고,
// 테스트와 측정 하니스는 이 손잡이만 흔들어 재시도·임계 동작을 결정론적으로 확인할 수 있다.
// pipelineDefaults 의 모든 잎이 여기 하나씩 대응한다 — 예외는 context.maxSceneBreakNewlines 뿐으로,
// 그 값은 파이프라인이 아니라 엔진의 씬 입력 조립에서 쓰인다.
export interface SceneGenerationTuning {
  readonly sectionRetryLimit?: number;
  readonly sectionMinimumLengthRatio?: number;
  readonly sectionRepeatedRunWindow?: number;
  readonly sectionRepeatedRunLimit?: number;
  readonly skeletonRatio?: number;
  readonly skeletonRetryLimit?: number;
  readonly skeletonMinimumLengthRatio?: number;
  readonly dialoguePreservedRatio?: number;
  readonly dialogueSplitLimit?: number;
  readonly dialogueRepeatedRunLimit?: number;
  readonly dialogueMinimumLineLength?: number;
  readonly dialogueMinimumQuotedLength?: number;
  readonly polishLengthLimitRatio?: number;
  readonly polishRetryLimit?: number;
  readonly paddingParagraphRatio?: number;
  readonly paddingParagraphMinimumLength?: number;
  readonly voiceSampleLimit?: number;
  readonly voiceSampleMinimumLength?: number;
  readonly voiceSampleMaximumLength?: number;
  readonly contextCondensedMaxChars?: number;
  readonly violationWeights?: Partial<ViolationWeights>;
}

export type ResolvedSceneGenerationTuning = Required<
  Omit<SceneGenerationTuning, 'violationWeights'>
> & {
  readonly violationWeights: ViolationWeights;
};

function resolveViolationWeights(overrides: Partial<ViolationWeights> | undefined): ViolationWeights {
  if (!overrides) {
    return pipelineDefaults.violationWeights;
  }

  return Object.fromEntries(
    sectionViolationKinds.map((kind) => [kind, overrides[kind] ?? pipelineDefaults.violationWeights[kind]]),
  ) as ViolationWeights;
}

// 생략한 손잡이를 데이터 파일의 기본값으로 채운다. pipelineDefaults 를 읽는 유일한 지점이라,
// 파이프라인 안쪽은 어디서도 기본값을 다시 적지 않는다.
export function resolveSceneGenerationTuning(
  tuning?: SceneGenerationTuning,
): ResolvedSceneGenerationTuning {
  return {
    sectionRetryLimit: tuning?.sectionRetryLimit ?? pipelineDefaults.section.retryLimit,
    sectionMinimumLengthRatio:
      tuning?.sectionMinimumLengthRatio ?? pipelineDefaults.section.minimumLengthRatio,
    sectionRepeatedRunWindow:
      tuning?.sectionRepeatedRunWindow ?? pipelineDefaults.section.repeatedRunWindow,
    sectionRepeatedRunLimit:
      tuning?.sectionRepeatedRunLimit ?? pipelineDefaults.section.repeatedRunLimit,
    skeletonRatio: tuning?.skeletonRatio ?? pipelineDefaults.skeleton.lengthRatio,
    skeletonRetryLimit: tuning?.skeletonRetryLimit ?? pipelineDefaults.skeleton.retryLimit,
    skeletonMinimumLengthRatio:
      tuning?.skeletonMinimumLengthRatio ?? pipelineDefaults.skeleton.minimumLengthRatio,
    dialoguePreservedRatio:
      tuning?.dialoguePreservedRatio ?? pipelineDefaults.dialogue.preservedRatio,
    dialogueSplitLimit: tuning?.dialogueSplitLimit ?? pipelineDefaults.dialogue.splitLimit,
    dialogueRepeatedRunLimit:
      tuning?.dialogueRepeatedRunLimit ?? pipelineDefaults.dialogue.repeatedRunLimit,
    dialogueMinimumLineLength:
      tuning?.dialogueMinimumLineLength ?? pipelineDefaults.dialogue.minimumLineLength,
    dialogueMinimumQuotedLength:
      tuning?.dialogueMinimumQuotedLength ?? pipelineDefaults.dialogue.minimumQuotedLength,
    polishLengthLimitRatio:
      tuning?.polishLengthLimitRatio ?? pipelineDefaults.polish.lengthLimitRatio,
    polishRetryLimit: tuning?.polishRetryLimit ?? pipelineDefaults.polish.retryLimit,
    paddingParagraphRatio: tuning?.paddingParagraphRatio ?? pipelineDefaults.padding.paragraphRatio,
    paddingParagraphMinimumLength:
      tuning?.paddingParagraphMinimumLength ?? pipelineDefaults.padding.paragraphMinimumLength,
    voiceSampleLimit: tuning?.voiceSampleLimit ?? pipelineDefaults.voiceSamples.limit,
    voiceSampleMinimumLength:
      tuning?.voiceSampleMinimumLength ?? pipelineDefaults.voiceSamples.minimumLength,
    voiceSampleMaximumLength:
      tuning?.voiceSampleMaximumLength ?? pipelineDefaults.voiceSamples.maximumLength,
    contextCondensedMaxChars:
      tuning?.contextCondensedMaxChars ?? pipelineDefaults.context.condensedMaxChars,
    violationWeights: resolveViolationWeights(tuning?.violationWeights),
  };
}

// 모델 프로필에만 있고 파이프라인이 안 읽는 손잡이는 오류 없이 무시되는 죽은 값이다. 이름이
// 어긋나는 순간 여기서 컴파일이 깨지게 해 둔다 — 타입이 아니라 키 집합을 본다.
const _profileKnobIsRead: keyof SceneGenerationTuning =
  null as unknown as keyof SceneGenerationTuningLike;
void _profileKnobIsRead;

// 값의 타입까지 맞는지도 함께 본다.
const _profileFitsTuning: SceneGenerationTuning = {} as SceneGenerationTuningLike;
void _profileFitsTuning;

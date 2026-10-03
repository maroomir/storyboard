import {
  generationParameterIds,
  sectionViolationKinds,
  type GenerationKnobs,
  type ViolationWeights,
} from '@storyboard/story-model';

import { pipelineDefaults } from './pipelineDefaults';

// The violation kinds and the weight scale are declared with the generation catalog in story-ai so
// the config, the model profile and the pipeline agree on them; the pipeline re-exports them.
export {
  sectionViolationKinds,
  type SectionViolationKind,
  type ViolationWeights,
} from '@storyboard/story-model';

// What a host hands the pipeline over its defaults, keyed by the public `generation.*` id. The
// values come from the model profile in the host's composition root; the pipeline never learns
// which model it is running.
export type SceneGenerationTuning = GenerationKnobs;

// The validators take either the host's partial knobs or a tuning the pipeline already resolved,
// so a stage never resolves twice.
export type SceneGenerationTuningInput = GenerationKnobs | ResolvedSceneGenerationTuning;

export interface ResolvedSceneGenerationTuning {
  readonly sectionRetryLimit: number;
  readonly sectionMinimumLengthRatio: number;
  readonly sectionRepeatedRunWindow: number;
  readonly sectionRepeatedRunLimit: number;
  readonly skeletonRatio: number;
  readonly skeletonRetryLimit: number;
  readonly skeletonMinimumLengthRatio: number;
  readonly dialoguePreservedRatio: number;
  readonly dialogueSplitLimit: number;
  readonly dialogueRepeatedRunLimit: number;
  readonly dialogueMinimumLineLength: number;
  readonly dialogueMinimumQuotedLength: number;
  readonly polishLengthLimitRatio: number;
  readonly polishRetryLimit: number;
  readonly paddingParagraphRatio: number;
  readonly paddingParagraphMinimumLength: number;
  readonly voiceSampleLimit: number;
  readonly voiceSampleMinimumLength: number;
  readonly voiceSampleMaximumLength: number;
  readonly contextCondensedMaxChars: number;
  readonly violationWeights: ViolationWeights;
}

// A knob's default is the leaf its id names in the defaults file: `generation.section.retryLimit`
// is `pipelineDefaults.section.retryLimit`. Reading it by path is what keeps the id and the value
// from drifting apart.
export function generationParameterDefault(id: string): number {
  const [prefix, group, leaf] = id.split('.');
  const section = (pipelineDefaults as unknown as Record<string, Record<string, number>>)[
    group ?? ''
  ];
  const value = section?.[leaf ?? ''];

  if (prefix !== 'generation' || typeof value !== 'number') {
    throw new Error(`알 수 없는 생성 손잡이입니다: ${id}`);
  }

  return value;
}

export function defaultGenerationKnobs(): Readonly<Record<string, number>> {
  return Object.fromEntries(
    generationParameterIds.map((id) => [id, generationParameterDefault(id)]),
  );
}

function knob(tuning: GenerationKnobs | undefined, id: string): number {
  return tuning?.[id] ?? generationParameterDefault(id);
}

// 생략한 손잡이를 데이터 파일의 기본값으로 채운다. pipelineDefaults 를 읽는 유일한 지점이라,
// 파이프라인 안쪽은 어디서도 기본값을 다시 적지 않는다.
export function isResolvedSceneGenerationTuning(
  tuning: SceneGenerationTuningInput | undefined,
): tuning is ResolvedSceneGenerationTuning {
  return (
    tuning !== undefined &&
    typeof (tuning as ResolvedSceneGenerationTuning).sectionRetryLimit === 'number' &&
    typeof (tuning as ResolvedSceneGenerationTuning).violationWeights === 'object'
  );
}

export function resolveSceneGenerationTuning(
  tuning?: SceneGenerationTuningInput,
): ResolvedSceneGenerationTuning {
  if (isResolvedSceneGenerationTuning(tuning)) {
    return tuning;
  }

  return {
    sectionRetryLimit: knob(tuning, 'generation.section.retryLimit'),
    sectionMinimumLengthRatio: knob(tuning, 'generation.section.minimumLengthRatio'),
    sectionRepeatedRunWindow: knob(tuning, 'generation.section.repeatedRunWindow'),
    sectionRepeatedRunLimit: knob(tuning, 'generation.section.repeatedRunLimit'),
    skeletonRatio: knob(tuning, 'generation.skeleton.lengthRatio'),
    skeletonRetryLimit: knob(tuning, 'generation.skeleton.retryLimit'),
    skeletonMinimumLengthRatio: knob(tuning, 'generation.skeleton.minimumLengthRatio'),
    dialoguePreservedRatio: knob(tuning, 'generation.dialogue.preservedRatio'),
    dialogueSplitLimit: knob(tuning, 'generation.dialogue.splitLimit'),
    dialogueRepeatedRunLimit: knob(tuning, 'generation.dialogue.repeatedRunLimit'),
    dialogueMinimumLineLength: knob(tuning, 'generation.dialogue.minimumLineLength'),
    dialogueMinimumQuotedLength: knob(tuning, 'generation.dialogue.minimumQuotedLength'),
    polishLengthLimitRatio: knob(tuning, 'generation.polish.lengthLimitRatio'),
    polishRetryLimit: knob(tuning, 'generation.polish.retryLimit'),
    paddingParagraphRatio: knob(tuning, 'generation.padding.paragraphRatio'),
    paddingParagraphMinimumLength: knob(tuning, 'generation.padding.paragraphMinimumLength'),
    voiceSampleLimit: knob(tuning, 'generation.voiceSamples.limit'),
    voiceSampleMinimumLength: knob(tuning, 'generation.voiceSamples.minimumLength'),
    voiceSampleMaximumLength: knob(tuning, 'generation.voiceSamples.maximumLength'),
    contextCondensedMaxChars: knob(tuning, 'generation.context.condensedMaxChars'),
    violationWeights: Object.fromEntries(
      sectionViolationKinds.map((kind) => [
        kind,
        knob(tuning, `generation.violationWeights.${kind}`),
      ]),
    ) as ViolationWeights,
  };
}

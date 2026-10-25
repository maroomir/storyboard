import {
  generationParameterIds,
  sectionViolationKinds,
  type GenerationKnobs,
  type ViolationWeights,
} from '@storyboard/story-model';

import { pipelineDefaults } from './pipelineDefaults';

export {
  sectionViolationKinds,
  type SectionViolationKind,
  type ViolationWeights,
} from '@storyboard/story-model';

export type SceneGenerationTuning = GenerationKnobs;

export type SceneGenerationTuningInput = GenerationKnobs | ResolvedSceneGenerationTuning;

export interface ResolvedSceneGenerationTuning {
  readonly sectionRetryLimit: number;
  readonly sectionMinimumLengthRatio: number;
  readonly sectionRepeatedRunWindow: number;
  readonly sectionRecapPhraseLimit: number;
  readonly sectionRepeatedRunLimit: number;
  readonly skeletonRatio: number;
  readonly skeletonRetryLimit: number;
  readonly skeletonMinimumLengthRatio: number;
  readonly skeletonThinDialogueTurns: number;
  readonly skeletonRequestedDialogueTurns: number;
  readonly skeletonCharsPerCall: number;
  readonly sceneBreakTimeJumpMinutes: number;
  readonly dialoguePreservedRatio: number;
  readonly dialogueSplitLimit: number;
  readonly dialogueRepeatedRunLimit: number;
  readonly dialogueMinimumLineLength: number;
  readonly dialogueMinimumQuotedLength: number;
  readonly polishLengthLimitRatio: number;
  readonly polishRetryLimit: number;
  readonly catchphrasePerBeatLimit: number;
  readonly actorRetryLimit: number;
  readonly actorLineMaxChars: number;
  readonly actorLineMaxSentences: number;
  readonly paddingParagraphRatio: number;
  readonly paddingParagraphMinimumLength: number;
  readonly voiceSampleLimit: number;
  readonly voiceSampleMinimumLength: number;
  readonly voiceSampleMaximumLength: number;
  readonly contextCondensedMaxChars: number;
  readonly violationWeights: ViolationWeights;
}

export function generationParameterDefault(id: string): number {
  const [prefix, group, leaf] = id.split('.');
  const section: Record<string, number> | undefined = (
    pipelineDefaults as unknown as Record<string, Record<string, number>>
  )[group ?? ''];
  const value: number | undefined = section?.[leaf ?? ''];

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
    sectionRecapPhraseLimit: knob(tuning, 'generation.section.recapPhraseLimit'),
    sectionRepeatedRunLimit: knob(tuning, 'generation.section.repeatedRunLimit'),
    skeletonRatio: knob(tuning, 'generation.skeleton.lengthRatio'),
    skeletonRetryLimit: knob(tuning, 'generation.skeleton.retryLimit'),
    skeletonMinimumLengthRatio: knob(tuning, 'generation.skeleton.minimumLengthRatio'),
    skeletonThinDialogueTurns: knob(tuning, 'generation.skeleton.thinDialogueTurns'),
    skeletonRequestedDialogueTurns: knob(tuning, 'generation.skeleton.requestedDialogueTurns'),
    skeletonCharsPerCall: knob(tuning, 'generation.skeleton.charsPerCall'),
    sceneBreakTimeJumpMinutes: knob(tuning, 'generation.sceneBreak.timeJumpMinutes'),
    dialoguePreservedRatio: knob(tuning, 'generation.dialogue.preservedRatio'),
    dialogueSplitLimit: knob(tuning, 'generation.dialogue.splitLimit'),
    dialogueRepeatedRunLimit: knob(tuning, 'generation.dialogue.repeatedRunLimit'),
    dialogueMinimumLineLength: knob(tuning, 'generation.dialogue.minimumLineLength'),
    dialogueMinimumQuotedLength: knob(tuning, 'generation.dialogue.minimumQuotedLength'),
    polishLengthLimitRatio: knob(tuning, 'generation.polish.lengthLimitRatio'),
    polishRetryLimit: knob(tuning, 'generation.polish.retryLimit'),
    catchphrasePerBeatLimit: knob(tuning, 'generation.catchphrase.perBeatLimit'),
    actorRetryLimit: knob(tuning, 'generation.actors.retryLimit'),
    actorLineMaxChars: knob(tuning, 'generation.actors.lineMaxChars'),
    actorLineMaxSentences: knob(tuning, 'generation.actors.lineMaxSentences'),
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

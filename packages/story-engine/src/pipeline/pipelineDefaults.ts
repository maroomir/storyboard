import type { ViolationWeights } from '@storyboard/story-model';
import { z } from 'zod';

import defaultsData from './pipelineDefaults.params.json';

const ratio: z.ZodNumber = z.number().positive().max(1);
const positiveInt: z.ZodNumber = z.number().int().positive();

export interface PipelineDefaultsSection {
  retryLimit: number;
  minimumLengthRatio: number;
  repeatedRunWindow: number;
  repeatedRunLimit: number;
  recapPhraseLimit: number;
}

export interface PipelineDefaultsSkeleton {
  lengthRatio: number;
  retryLimit: number;
  minimumLengthRatio: number;
  thinDialogueTurns: number;
  requestedDialogueTurns: number;
  charsPerCall: number;
}

export interface PipelineDefaultsDialogue {
  preservedRatio: number;
  splitLimit: number;
  repeatedRunLimit: number;
  minimumLineLength: number;
  minimumQuotedLength: number;
}

export interface PipelineDefaultsActors {
  retryLimit: number;
  lineMaxChars: number;
  lineMaxSentences: number;
}

export interface PipelineDefaultsVoiceSamples {
  limit: number;
  minimumLength: number;
  maximumLength: number;
}

export interface PipelineDefaults {
  section: PipelineDefaultsSection;
  skeleton: PipelineDefaultsSkeleton;
  sceneBreak: { timeJumpMinutes: number };
  dialogue: PipelineDefaultsDialogue;
  polish: { lengthLimitRatio: number; retryLimit: number };
  catchphrase: { perBeatLimit: number };
  actors: PipelineDefaultsActors;
  padding: { paragraphRatio: number; paragraphMinimumLength: number };
  voiceSamples: PipelineDefaultsVoiceSamples;
  context: { condensedMaxChars: number; maxSceneBreakNewlines: number };
  violationWeights: ViolationWeights;
}

const pipelineDefaultsSchema: z.ZodType<PipelineDefaults> = z.object({
  section: z.object({
    retryLimit: z.number().int().nonnegative(),
    minimumLengthRatio: ratio,
    repeatedRunWindow: positiveInt,
    repeatedRunLimit: positiveInt,
    recapPhraseLimit: z.number().int().nonnegative(),
  }),
  skeleton: z.object({
    lengthRatio: ratio,
    retryLimit: z.number().int().nonnegative(),
    minimumLengthRatio: ratio,
    thinDialogueTurns: positiveInt,
    requestedDialogueTurns: positiveInt,
    charsPerCall: positiveInt,
  }),
  sceneBreak: z.object({
    timeJumpMinutes: positiveInt,
  }),
  dialogue: z.object({
    preservedRatio: ratio,
    splitLimit: positiveInt,
    repeatedRunLimit: positiveInt,
    minimumLineLength: positiveInt,
    minimumQuotedLength: positiveInt,
  }),
  polish: z.object({
    lengthLimitRatio: z.number().positive(),
    retryLimit: positiveInt,
  }),
  catchphrase: z.object({
    perBeatLimit: positiveInt,
  }),
  actors: z.object({
    retryLimit: z.number().int().nonnegative(),
    lineMaxChars: positiveInt,
    lineMaxSentences: positiveInt,
  }),
  padding: z.object({
    paragraphRatio: ratio,
    paragraphMinimumLength: positiveInt,
  }),
  voiceSamples: z.object({
    limit: positiveInt,
    minimumLength: positiveInt,
    maximumLength: positiveInt,
  }),
  context: z.object({
    condensedMaxChars: positiveInt,
    maxSceneBreakNewlines: positiveInt,
  }),
  violationWeights: z.object({
    cast: positiveInt,
    place: positiveInt,
    'foreign-script': positiveInt,
    'dialogue-count': positiveInt,
    'lost-dialogue': positiveInt,
    'repeats-previous': positiveInt,
    repetition: positiveInt,
    'too-long': positiveInt,
    'too-short': positiveInt,
    'scene-breaks': positiveInt,
    'runs-ahead': positiveInt,
    'missing-beats': positiveInt,
  }),
});

export const pipelineDefaults: PipelineDefaults = pipelineDefaultsSchema.parse(defaultsData);

import { z } from 'zod';

import type { BibleSubjectKind } from '#model/format/bible';

export interface InterviewAxisValue {
  readonly id: string;
  readonly label: string;
}

export interface InterviewAxis {
  readonly id: string;
  readonly label: string;
  readonly values: readonly InterviewAxisValue[];
}

export interface InterviewAxisSet {
  readonly generatedAt: string;
  readonly contractHash: string;
  readonly axes: readonly InterviewAxis[];
}

export interface InterviewAxesFile {
  readonly version: 1;
  readonly character?: InterviewAxisSet;
  readonly background?: InterviewAxisSet;
}

export type InterviewQuestionSource =
  | { readonly kind: 'beat'; readonly sceneStem: string; readonly beatIndex: number }
  | { readonly kind: 'offBeat' };

export interface InterviewOption {
  readonly valueId: string;
  readonly text: string;
  readonly isExploration: boolean;
}

export type InterviewAnswer =
  | { readonly kind: 'chosen'; readonly index: number }
  | {
      readonly kind: 'written';
      readonly text: string;
      readonly valueId: string;
      readonly isNewValue: boolean;
    }
  | { readonly kind: 'skipped' };

export interface InterviewRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly askedAt: string;
  readonly source: InterviewQuestionSource;
  readonly axisId: string;
  readonly situation: string;
  readonly question: string;
  readonly options: readonly InterviewOption[];
  readonly answer?: InterviewAnswer;
  readonly isConfirmed: boolean;
}

export type InterviewTallies = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface InterviewWorkingModel {
  readonly version: 1;
  readonly cardId: string;
  readonly cardType: BibleSubjectKind;
  readonly cardHash: string;
  readonly summary: string;
  readonly tallies: InterviewTallies;
  readonly records: readonly InterviewRecord[];
  readonly writtenStreak: number;
  readonly distilledThrough: number;
}

const idSchema: z.ZodString = z.string().trim().min(1);

const interviewAxisValueSchema: z.ZodType<InterviewAxisValue> = z.object({
  id: idSchema,
  label: idSchema,
});

const interviewAxisSchema: z.ZodType<InterviewAxis> = z.object({
  id: idSchema,
  label: idSchema,
  values: z.array(interviewAxisValueSchema),
});

const interviewAxisSetSchema: z.ZodType<InterviewAxisSet> = z.object({
  generatedAt: z.string().datetime(),
  contractHash: idSchema,
  axes: z.array(interviewAxisSchema),
});

export const interviewAxesFileSchema: z.ZodType<InterviewAxesFile> = z.object({
  version: z.literal(1),
  character: interviewAxisSetSchema.optional(),
  background: interviewAxisSetSchema.optional(),
});

const interviewQuestionSourceSchema: z.ZodType<InterviewQuestionSource> = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('beat'),
      sceneStem: idSchema,
      beatIndex: z.number().int().nonnegative(),
    }),
    z.object({ kind: z.literal('offBeat') }),
  ],
);

const interviewOptionSchema: z.ZodType<InterviewOption> = z.object({
  valueId: idSchema,
  text: idSchema,
  isExploration: z.boolean(),
});

const interviewAnswerSchema: z.ZodType<InterviewAnswer> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('chosen'), index: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal('written'),
    text: idSchema,
    valueId: idSchema,
    isNewValue: z.boolean(),
  }),
  z.object({ kind: z.literal('skipped') }),
]);

const interviewRecordSchema: z.ZodType<InterviewRecord> = z.object({
  id: idSchema,
  sessionId: idSchema,
  askedAt: z.string().datetime(),
  source: interviewQuestionSourceSchema,
  axisId: idSchema,
  situation: idSchema,
  question: idSchema,
  options: z.array(interviewOptionSchema),
  answer: interviewAnswerSchema.optional(),
  isConfirmed: z.boolean(),
});

export const interviewWorkingModelSchema: z.ZodType<InterviewWorkingModel> = z.object({
  version: z.literal(1),
  cardId: idSchema,
  cardType: z.enum(['character', 'background']),
  cardHash: idSchema,
  summary: z.string(),
  tallies: z.record(z.string(), z.record(z.string(), z.number().nonnegative())),
  records: z.array(interviewRecordSchema),
  writtenStreak: z.number().int().nonnegative(),
  distilledThrough: z.number().int().nonnegative(),
});

export const emptyInterviewAxesFile: InterviewAxesFile = { version: 1 };

export interface InterviewQuestion {
  readonly id: string;
  readonly sessionId: string;
  readonly axisId: string;
  readonly axisLabel: string;
  readonly values: readonly InterviewAxisValue[];
  readonly source: InterviewQuestionSource;
  readonly situation: string;
  readonly question: string;
  readonly options: readonly InterviewOption[];
}

export interface InterviewOpenAxis {
  readonly axisId: string;
  readonly axisLabel: string;
  readonly beatSituations: readonly InterviewBeatSituation[];
}

export interface InterviewBeatSituation {
  readonly sceneStem: string;
  readonly beatIndex: number;
  readonly text: string;
  readonly cast: readonly string[];
  readonly place?: string;
  readonly time?: string;
}

export interface InterviewCardCoverage {
  readonly cardId: string;
  readonly cardType: BibleSubjectKind;
  readonly name: string;
  readonly hasWorkingModel: boolean;
  readonly openAxes: readonly InterviewOpenAxis[];
  readonly upcomingSceneStems: readonly string[];
}

export interface InterviewClassification {
  readonly valueId: string;
  readonly valueLabel: string;
  readonly isNewValue: boolean;
}

export type InterviewAnswerInput =
  | { readonly kind: 'chosen'; readonly index: number }
  | { readonly kind: 'written'; readonly text: string }
  | { readonly kind: 'skipped' };

export interface InterviewAnswerOutcome {
  readonly classification?: InterviewClassification;
  readonly isRebuilt: boolean;
  readonly answeredCount: number;
}

export interface InterviewSessionSummary {
  readonly sessionId: string;
  readonly cardId: string;
  readonly answered: number;
  readonly skipped: number;
  readonly candidateCount: number;
  readonly undecidedAxisLabels: readonly string[];
}

export interface InterviewOpening {
  readonly sessionId: string;
  readonly cardId: string;
  readonly cardType: BibleSubjectKind;
  readonly name: string;
  readonly coverage: InterviewCardCoverage;
  readonly isContractStale: boolean;
  readonly maxQuestions: number;
}

export type InterviewConfirmation =
  | { readonly kind: 'value'; readonly valueId: string }
  | { readonly kind: 'newValue'; readonly id: string; readonly label: string };

const cardTypeSchema: z.ZodType<BibleSubjectKind> = z.enum(['character', 'background']);

export const interviewQuestionSchema: z.ZodType<InterviewQuestion> = z.object({
  id: idSchema,
  sessionId: idSchema,
  axisId: idSchema,
  axisLabel: idSchema,
  values: z.array(interviewAxisValueSchema),
  source: interviewQuestionSourceSchema,
  situation: idSchema,
  question: idSchema,
  options: z.array(interviewOptionSchema),
});

const interviewBeatSituationSchema: z.ZodType<InterviewBeatSituation> = z.object({
  sceneStem: idSchema,
  beatIndex: z.number().int().nonnegative(),
  text: z.string(),
  cast: z.array(z.string()),
  place: z.string().optional(),
  time: z.string().optional(),
});

const interviewOpenAxisSchema: z.ZodType<InterviewOpenAxis> = z.object({
  axisId: idSchema,
  axisLabel: idSchema,
  beatSituations: z.array(interviewBeatSituationSchema),
});

export const interviewCardCoverageSchema: z.ZodType<InterviewCardCoverage> = z.object({
  cardId: idSchema,
  cardType: cardTypeSchema,
  name: idSchema,
  hasWorkingModel: z.boolean(),
  openAxes: z.array(interviewOpenAxisSchema),
  upcomingSceneStems: z.array(z.string()),
});

export const interviewOpeningSchema: z.ZodType<InterviewOpening> = z.object({
  sessionId: idSchema,
  cardId: idSchema,
  cardType: cardTypeSchema,
  name: idSchema,
  coverage: interviewCardCoverageSchema,
  isContractStale: z.boolean(),
  maxQuestions: z.number().int().positive(),
});

export const interviewAnswerInputSchema: z.ZodType<InterviewAnswerInput> = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('chosen'), index: z.number().int().nonnegative() }),
    z.object({ kind: z.literal('written'), text: z.string().trim().min(1) }),
    z.object({ kind: z.literal('skipped') }),
  ],
);

const interviewClassificationSchema: z.ZodType<InterviewClassification> = z.object({
  valueId: idSchema,
  valueLabel: idSchema,
  isNewValue: z.boolean(),
});

export const interviewAnswerOutcomeSchema: z.ZodType<InterviewAnswerOutcome> = z.object({
  classification: interviewClassificationSchema.optional(),
  isRebuilt: z.boolean(),
  answeredCount: z.number().int().nonnegative(),
});

export const interviewConfirmationSchema: z.ZodType<InterviewConfirmation> = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('value'), valueId: idSchema }),
    z.object({ kind: z.literal('newValue'), id: idSchema, label: idSchema }),
  ],
);

export const interviewSessionSummarySchema: z.ZodType<InterviewSessionSummary> = z.object({
  sessionId: idSchema,
  cardId: idSchema,
  answered: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  undecidedAxisLabels: z.array(z.string()),
});

import { z } from 'zod';

import {
  interviewAnswerInputSchema,
  interviewAnswerOutcomeSchema,
  interviewConfirmationSchema,
  interviewOpeningSchema,
  interviewQuestionSchema,
  interviewSessionSummarySchema,
  type InterviewAnswerInput,
  type InterviewAnswerOutcome,
  type InterviewConfirmation,
  type InterviewOpening,
  type InterviewQuestion,
  type InterviewSessionSummary,
} from '#model/format/interview';
import { uriStringSchema } from '#model/shared/messaging/atoms';

export interface InterviewsStartRequestPayload {
  uri: string;
  sceneStems?: string[];
  shouldResetAxes?: boolean;
}

export const interviewsStartRequestPayloadSchema: z.ZodType<InterviewsStartRequestPayload> = z.object({
  uri: uriStringSchema,
  sceneStems: z.array(z.string().trim().min(1)).optional(),
  shouldResetAxes: z.boolean().optional(),
});

export interface InterviewsSessionRequestPayload {
  uri: string;
  sessionId: string;
  sceneStems?: string[];
}

export const interviewsSessionRequestPayloadSchema: z.ZodType<InterviewsSessionRequestPayload> =
  z.object({
    uri: uriStringSchema,
    sessionId: z.string().trim().min(1),
    sceneStems: z.array(z.string().trim().min(1)).optional(),
  });

export interface InterviewsAnswerRequestPayload extends InterviewsSessionRequestPayload {
  questionId: string;
  answer: InterviewAnswerInput;
}

export const interviewsAnswerRequestPayloadSchema: z.ZodType<InterviewsAnswerRequestPayload> =
  z.object({
    uri: uriStringSchema,
    sessionId: z.string().trim().min(1),
    sceneStems: z.array(z.string().trim().min(1)).optional(),
    questionId: z.string().trim().min(1),
    answer: interviewAnswerInputSchema,
  });

export interface InterviewsConfirmRequestPayload extends InterviewsSessionRequestPayload {
  questionId: string;
  confirmation: InterviewConfirmation;
}

export const interviewsConfirmRequestPayloadSchema: z.ZodType<InterviewsConfirmRequestPayload> =
  z.object({
    uri: uriStringSchema,
    sessionId: z.string().trim().min(1),
    sceneStems: z.array(z.string().trim().min(1)).optional(),
    questionId: z.string().trim().min(1),
    confirmation: interviewConfirmationSchema,
  });

export interface InterviewsStartResponsePayload {
  opening: InterviewOpening;
}

export const interviewsStartResponsePayloadSchema: z.ZodType<InterviewsStartResponsePayload> =
  z.object({ opening: interviewOpeningSchema });

export interface InterviewsNextResponsePayload {
  question: InterviewQuestion | null;
}

export const interviewsNextResponsePayloadSchema: z.ZodType<InterviewsNextResponsePayload> =
  z.object({ question: interviewQuestionSchema.nullable() });

export interface InterviewsAnswerResponsePayload {
  outcome: InterviewAnswerOutcome;
}

export const interviewsAnswerResponsePayloadSchema: z.ZodType<InterviewsAnswerResponsePayload> =
  z.object({ outcome: interviewAnswerOutcomeSchema });

export type InterviewsConfirmResponsePayload = Record<string, never>;

export const interviewsConfirmResponsePayloadSchema: z.ZodType<InterviewsConfirmResponsePayload> =
  z.object({}).strict() as z.ZodType<InterviewsConfirmResponsePayload>;

export interface InterviewsFinishResponsePayload {
  summary: InterviewSessionSummary;
}

export const interviewsFinishResponsePayloadSchema: z.ZodType<InterviewsFinishResponsePayload> =
  z.object({ summary: interviewSessionSummarySchema });

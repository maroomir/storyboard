import type {
  InterviewAnswerInput,
  InterviewAnswerOutcome,
  InterviewClassification,
  InterviewConfirmation,
  InterviewOpening,
  InterviewQuestion,
  InterviewSessionSummary,
  StoryboardCard,
  StoryUri,
} from '@storyboard/story-model';

import type { UseCaseFailure } from '#engine/application/useCase';

export type { InterviewConfirmation, InterviewOpening };

export interface InterviewStartRequest {
  readonly workspaceRoot: StoryUri;
  readonly cardId: string;
  readonly card?: StoryboardCard;
  readonly sceneStems?: readonly string[];
  readonly shouldResetAxes?: boolean;
}

export type InterviewStartResult =
  | { readonly ok: true; readonly opening: InterviewOpening }
  | { readonly ok: false; readonly kind: 'card-not-found'; readonly message: string }
  | UseCaseFailure;

export interface InterviewSessionRequest {
  readonly workspaceRoot: StoryUri;
  readonly cardId: string;
  readonly card?: StoryboardCard;
  readonly sessionId: string;
  readonly sceneStems?: readonly string[];
  readonly shouldAskKnown?: boolean;
}

export interface InterviewResumeRequest {
  readonly workspaceRoot: StoryUri;
  readonly cardId: string;
  readonly card?: StoryboardCard;
  readonly sceneStems?: readonly string[];
}

export type InterviewOpenSessionStep =
  | { readonly kind: 'answer' }
  | { readonly kind: 'confirm'; readonly classification: InterviewClassification };

export interface InterviewOpenSession {
  readonly opening: InterviewOpening;
  readonly question: InterviewQuestion;
  readonly step: InterviewOpenSessionStep;
  readonly answeredCount: number;
}

export interface InterviewAnswerRequest extends InterviewSessionRequest {
  readonly questionId: string;
  readonly answer: InterviewAnswerInput;
}

export interface InterviewConfirmRequest extends InterviewSessionRequest {
  readonly questionId: string;
  readonly confirmation: InterviewConfirmation;
}

export interface IQuestionStrategy {
  start(request: InterviewStartRequest): Promise<InterviewStartResult>;
  findOpenSession(request: InterviewResumeRequest): Promise<InterviewOpenSession | undefined>;
  abandon(request: InterviewSessionRequest): Promise<void>;
  next(request: InterviewSessionRequest): Promise<InterviewQuestion | undefined>;
  answer(request: InterviewAnswerRequest): Promise<InterviewAnswerOutcome>;
  confirm(request: InterviewConfirmRequest): Promise<void>;
  finish(request: InterviewSessionRequest): Promise<InterviewSessionSummary>;
}

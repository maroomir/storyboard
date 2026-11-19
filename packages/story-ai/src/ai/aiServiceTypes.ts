import type {
  StyleDirective,
  AiGenerateResponse,
  AiMessage,
  AiProviderId,
  AiTaskName,
  ReasoningEffort,
  TraceCallTag,
  UsageAttribution,
  UsageRecord,
} from '@storyboard/story-model';

export interface GenerateTextOptions {
  readonly providerId?: AiProviderId;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly attribution?: UsageAttribution;
  readonly styleDirective?: StyleDirective;
  readonly traceTag?: TraceCallTag;
}

export type OnUsageRecordCallback = (record: UsageRecord) => void;

export interface AiCallObservation {
  readonly taskName: AiTaskName;
  readonly messages: readonly AiMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly response?: AiGenerateResponse;
  readonly error?: unknown;
  readonly traceTag?: TraceCallTag;
}

export type OnAiCallCallback = (observation: AiCallObservation) => void;

export interface StoryboardAiServiceOptions {
  readonly onUsage?: OnUsageRecordCallback;
  readonly onCall?: OnAiCallCallback;
}

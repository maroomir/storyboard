import { z } from 'zod';

import { STORYBOARD_RELATIVE_PATHS } from '#model/format/paths';

export const generationTraceFormatVersion: number = 1;

export type TraceRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export const traceRunStatuses: readonly TraceRunStatus[] = ['running', 'completed', 'failed', 'cancelled'];

export interface TraceRunSubject {
  readonly sceneStem?: string;
  readonly sceneId?: string;
}

export interface TraceRunHeader {
  readonly version: number;
  readonly runId: string;
  readonly kind: string;
  readonly status: TraceRunStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly subject: TraceRunSubject;
  readonly failureMessage?: string;
}

export interface TraceCallTag {
  readonly stage?: string;
  readonly sectionIndex?: number;
  readonly beatIds?: readonly string[];
  readonly attempt?: number;
  readonly retryReason?: string;
}

export interface TraceTextRef {
  readonly hash: string;
  readonly charCount: number;
}

export interface TraceCallMessage extends TraceTextRef {
  readonly role: string;
}

export interface TraceCallParameters {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly reasoningEffort?: string;
}

export interface TraceCallResponse extends TraceTextRef {
  readonly isTruncated: boolean;
}

export interface TraceCallUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
}

export interface TraceCallRecord {
  readonly sequence: number;
  readonly taskName: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly parameters: TraceCallParameters;
  readonly messages: readonly TraceCallMessage[];
  readonly response?: TraceCallResponse;
  readonly errorMessage?: string;
  readonly usage?: TraceCallUsage;
  readonly costUsd?: number;
  readonly tag?: TraceCallTag;
}

const traceTextRefShape: { hash: z.ZodString; charCount: z.ZodNumber } = {
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  charCount: z.number().int().min(0),
};

const traceCallTagSchema: z.ZodType<TraceCallTag> = z.object({
  stage: z.string().optional(),
  sectionIndex: z.number().int().optional(),
  beatIds: z.array(z.string()).optional(),
  attempt: z.number().int().optional(),
  retryReason: z.string().optional(),
});

export const traceRunHeaderSchema: z.ZodType<TraceRunHeader> = z.object({
  version: z.number().int(),
  runId: z.string().min(1),
  kind: z.string().min(1),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  subject: z.object({ sceneStem: z.string().optional(), sceneId: z.string().optional() }),
  failureMessage: z.string().optional(),
});

export const traceCallRecordSchema: z.ZodType<TraceCallRecord> = z.object({
  sequence: z.number().int().min(1),
  taskName: z.string().min(1),
  providerId: z.string().optional(),
  model: z.string().optional(),
  startedAt: z.string(),
  durationMs: z.number().min(0),
  parameters: z.object({
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    reasoningEffort: z.string().optional(),
  }),
  messages: z.array(z.object({ role: z.string(), ...traceTextRefShape })),
  response: z.object({ ...traceTextRefShape, isTruncated: z.boolean() }).optional(),
  errorMessage: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadInputTokens: z.number().optional(),
      cacheCreationInputTokens: z.number().optional(),
    })
    .optional(),
  costUsd: z.number().optional(),
  tag: traceCallTagSchema.optional(),
});

const sequenceDigitCount: number = 5;

export function traceRunRelativeDirectory(runId: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.traceDirectory}/${runId}`;
}

export function traceRunHeaderRelativePath(runId: string): string {
  return `${traceRunRelativeDirectory(runId)}/run.json`;
}

export function traceCallRelativePath(runId: string, sequence: number): string {
  return `${traceRunRelativeDirectory(runId)}/calls/${String(sequence).padStart(sequenceDigitCount, '0')}.json`;
}

export function traceBlobRelativePath(runId: string, hash: string): string {
  return `${traceRunRelativeDirectory(runId)}/blobs/${hash}.txt`;
}

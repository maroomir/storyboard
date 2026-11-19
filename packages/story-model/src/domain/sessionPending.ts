import { z } from 'zod';

import { statementListSchema, type Statement } from '#model/element/statement';
import { interviewDistillExclusionSchema, type InterviewDistillExclusion } from '#model/format/interview';

interface PendingStatementsEnvelope {
  readonly pendingStatements: readonly Statement[];
}

const pendingStatementsEnvelopeSchema: z.ZodType<PendingStatementsEnvelope> = z.object({
  pendingStatements: statementListSchema,
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPendingStatements(sessionData: unknown): readonly Statement[] {
  const parsed: z.ZodSafeParseResult<PendingStatementsEnvelope> =
    pendingStatementsEnvelopeSchema.safeParse(sessionData);

  return parsed.success ? parsed.data.pendingStatements : [];
}

export type PendingHeaderChange = Readonly<Record<string, unknown>>;

export function readPendingHeader(sessionData: unknown): PendingHeaderChange | undefined {
  const header: unknown = isRecord(sessionData) ? sessionData.pendingHeader : undefined;
  return isRecord(header) && Object.keys(header).length > 0 ? header : undefined;
}

export function replacePendingHeader(
  sessionData: unknown,
  pendingHeader: PendingHeaderChange | undefined,
): Readonly<Record<string, unknown>> {
  const { pendingHeader: _previous, ...rest } = isRecord(sessionData) ? sessionData : {};
  return pendingHeader === undefined ? rest : { ...rest, pendingHeader };
}

export function replacePendingStatements(
  sessionData: unknown,
  pendingStatements: readonly Statement[],
): Readonly<Record<string, unknown>> {
  return { ...(isRecord(sessionData) ? sessionData : {}), pendingStatements };
}

const pendingExclusionsSchema: z.ZodType<readonly InterviewDistillExclusion[]> = z.array(interviewDistillExclusionSchema);

export function readPendingExclusions(sessionData: unknown): readonly InterviewDistillExclusion[] {
  const parsed: z.ZodSafeParseResult<readonly InterviewDistillExclusion[]> = pendingExclusionsSchema.safeParse(
    isRecord(sessionData) ? sessionData.pendingExclusions : undefined,
  );

  return parsed.success ? parsed.data : [];
}

export function replacePendingExclusions(
  sessionData: unknown,
  pendingExclusions: readonly InterviewDistillExclusion[],
): Readonly<Record<string, unknown>> {
  const { pendingExclusions: _previous, ...rest } = isRecord(sessionData) ? sessionData : {};
  return pendingExclusions.length === 0 ? rest : { ...rest, pendingExclusions };
}

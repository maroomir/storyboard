import { z } from 'zod';

import { statementListSchema, type Statement } from '#model/element/statement';

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

export function replacePendingStatements(
  sessionData: unknown,
  pendingStatements: readonly Statement[],
): Readonly<Record<string, unknown>> {
  return { ...(isRecord(sessionData) ? sessionData : {}), pendingStatements };
}

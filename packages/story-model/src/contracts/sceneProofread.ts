import { z } from 'zod';

import { parseJsonArray } from '#model/contracts/aiResponseParser';

export interface ProofreadEdit {
  readonly before: string;
  readonly after: string;
}

const proofreadEditSchema: z.ZodType<ProofreadEdit> = z.object({
  before: z.string().min(1),
  after: z.string(),
});

export function coerceProofreadEdits(rawText: string): ProofreadEdit[] {
  const parsedArray: unknown[] = parseJsonArray(rawText) ?? [];

  return parsedArray.flatMap((item: unknown): ProofreadEdit[] => {
    const parsed: z.ZodSafeParseResult<ProofreadEdit> = proofreadEditSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

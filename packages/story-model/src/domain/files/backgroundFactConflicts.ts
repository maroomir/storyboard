import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  listBackgroundFactLines,
  type BackgroundFactConflict,
} from '#model/contracts/backgroundFactConflicts';
import type { BackgroundCard } from '#model/format/card';

export interface BackgroundFactConflictRecord {
  readonly inputKey: string;
  readonly conflicts: readonly BackgroundFactConflict[];
}

const backgroundFactConflictListSchema: z.ZodType<BackgroundFactConflict[]> = z.array(
  z.object({ items: z.tuple([z.string(), z.string()]) }),
);

export function computeBackgroundFactConflictKey(
  card: BackgroundCard,
  promptFingerprint: string,
): string {
  const source: string = JSON.stringify({
    lines: listBackgroundFactLines(card),
    promptFingerprint,
  });

  return createHash('sha256').update(source).digest('hex');
}

export function parseBackgroundFactConflictList(
  data: unknown,
): readonly BackgroundFactConflict[] | undefined {
  const parsed: z.ZodSafeParseResult<BackgroundFactConflict[]> =
    backgroundFactConflictListSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

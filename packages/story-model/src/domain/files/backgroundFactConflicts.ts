import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  listBackgroundFactLines,
  type BackgroundFactConflict,
} from '#model/contracts/backgroundFactConflicts';
import type { BackgroundCard } from '#model/format/card';

// What the conflict check found per background card, keyed by what it read. Asking again about the
// same lines gets the same answer at the same price, so the answer is kept until the card or the
// prompt changes. It lives in the git-ignored cache: `doctor` reads it, nothing in the work does.
export interface BackgroundFactConflictRecord {
  readonly inputKey: string;
  readonly conflicts: readonly BackgroundFactConflict[];
}

const backgroundFactConflictRecordsSchema = z.object({
  version: z.literal(1),
  cards: z.record(
    z.string(),
    z.object({
      inputKey: z.string().min(1),
      conflicts: z.array(z.object({ items: z.tuple([z.string(), z.string()]) })),
    }),
  ),
});

export type BackgroundFactConflictRecords = Readonly<Record<string, BackgroundFactConflictRecord>>;

export function computeBackgroundFactConflictKey(
  card: BackgroundCard,
  promptFingerprint: string,
): string {
  const source = JSON.stringify({ lines: listBackgroundFactLines(card), promptFingerprint });

  return createHash('sha256').update(source).digest('hex');
}

// A file that cannot be read is treated as empty: the worst case is one more check.
export function parseBackgroundFactConflictRecords(raw: string): BackgroundFactConflictRecords {
  try {
    const parsed = backgroundFactConflictRecordsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.cards : {};
  } catch {
    return {};
  }
}

export function serializeBackgroundFactConflictRecords(
  records: BackgroundFactConflictRecords,
): string {
  return `${JSON.stringify({ version: 1, cards: records }, null, 2)}\n`;
}

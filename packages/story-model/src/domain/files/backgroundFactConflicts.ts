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

interface BackgroundFactConflictRecordsPayload {
  version: 1;
  cards: Record<string, { inputKey: string; conflicts: { items: [string, string] }[] }>;
}

const backgroundFactConflictRecordsSchema: z.ZodType<BackgroundFactConflictRecordsPayload> =
  z.object({
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
  const source: string = JSON.stringify({
    lines: listBackgroundFactLines(card),
    promptFingerprint,
  });

  return createHash('sha256').update(source).digest('hex');
}

export function parseBackgroundFactConflictRecords(raw: string): BackgroundFactConflictRecords {
  try {
    const parsed: z.ZodSafeParseResult<BackgroundFactConflictRecordsPayload> =
      backgroundFactConflictRecordsSchema.safeParse(JSON.parse(raw));
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

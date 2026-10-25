import { z } from 'zod';

import type { BackgroundCard } from '#model/format/card';

export interface BackgroundFactConflict {
  readonly items: readonly [string, string];
}

export function listBackgroundFactLines(card: BackgroundCard): string[] {
  return [card.time, ...(card.description ?? []), ...(card.senses ?? [])]
    .filter((line): line is string => line !== undefined && line.trim().length > 0)
    .map((line) => line.trim());
}

interface BackgroundFactConflictResponse {
  conflicts: { items: string[] }[];
}

const backgroundFactConflictResponseSchema: z.ZodType<BackgroundFactConflictResponse> = z.object({
  conflicts: z.array(z.object({ items: z.array(z.string()) })).default([]),
});

export function readBackgroundFactConflictResponse(
  raw: unknown,
  factLines: readonly string[],
): BackgroundFactConflict[] {
  const parsed: z.ZodSafeParseResult<BackgroundFactConflictResponse> =
    backgroundFactConflictResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return [];
  }

  const known: Set<string> = new Set(factLines);
  const seen: Set<string> = new Set<string>();

  return parsed.data.conflicts.flatMap((conflict) => {
    const [first, second] = conflict.items.map((item) => item.trim());
    if (first === undefined || second === undefined || first === second) {
      return [];
    }
    if (!known.has(first) || !known.has(second)) {
      return [];
    }

    const key: string = [first, second].sort().join('\n');
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);

    return [{ items: [first, second] as const }];
  });
}

export function formatBackgroundFactConflict(conflict: BackgroundFactConflict): string {
  return `「${conflict.items[0]}」 ↔ 「${conflict.items[1]}」`;
}

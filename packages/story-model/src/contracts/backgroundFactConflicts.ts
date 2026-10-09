import { z } from 'zod';

import type { BackgroundCard } from '#model/format/card';

// Two lines of one background card that cannot both hold ("sleeps on the living-room sofa" and
// "has a room of her own"). Both stay on the card; the author is told, and generation is asked to
// use only the one the events fit.
export interface BackgroundFactConflict {
  readonly items: readonly [string, string];
}

// The lines a conflict may name: what the card states about the place itself. Weather and tags are
// left out — a single value cannot contradict itself, and a tag is not a statement.
export function listBackgroundFactLines(card: BackgroundCard): string[] {
  return [card.time, ...(card.description ?? []), ...(card.senses ?? [])]
    .filter((line): line is string => line !== undefined && line.trim().length > 0)
    .map((line) => line.trim());
}

const backgroundFactConflictResponseSchema = z.object({
  conflicts: z.array(z.object({ items: z.array(z.string()) })).default([]),
});

// A pair is kept only when both of its lines are lines of the card, word for word: the model picks
// from the card, it never paraphrases into it. An unreadable answer is no conflict.
export function readBackgroundFactConflictResponse(
  raw: unknown,
  factLines: readonly string[],
): BackgroundFactConflict[] {
  const parsed = backgroundFactConflictResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return [];
  }

  const known = new Set(factLines);
  const seen = new Set<string>();

  return parsed.data.conflicts.flatMap((conflict) => {
    const [first, second] = conflict.items.map((item) => item.trim());
    if (first === undefined || second === undefined || first === second) {
      return [];
    }
    if (!known.has(first) || !known.has(second)) {
      return [];
    }

    const key = [first, second].sort().join('\n');
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

import { z } from 'zod';

// A person whose traits and tags came from more than one reading of the notes, or who already has
// some on their card. `existing` is what the card holds and is never proposed again; `traits` and
// `tags` are the candidates the model narrows to one item per meaning.
export interface NoteConsolidationTarget {
  readonly cardId: string;
  readonly name: string;
  readonly existingTraits: readonly string[];
  readonly existingTags: readonly string[];
  readonly traits: readonly string[];
  readonly tags: readonly string[];
}

export interface NoteConsolidatedLists {
  readonly cardId: string;
  readonly traits: readonly string[];
  readonly tags: readonly string[];
}

export type NoteConsolidationFailure = 'truncated' | 'unparsed';

export interface NoteConsolidationResult {
  readonly consolidated: readonly NoteConsolidatedLists[];
  readonly failure?: NoteConsolidationFailure;
}

const textList = z
  .preprocess(
    (value) =>
      Array.isArray(value)
        ? value.filter((item) => typeof item === 'string' && item.trim().length > 0)
        : [],
    z.array(z.string().trim().min(1)),
  )
  .optional()
  .transform((value) => value ?? []);

const consolidatedListsSchema = z.object({
  id: z.string().trim().min(1),
  traits: textList,
  tags: textList,
});

export function readNoteConsolidationResponse(
  parsed: Record<string, unknown> | null,
  isTruncated: boolean,
): NoteConsolidationResult {
  if (isTruncated) {
    return { consolidated: [], failure: 'truncated' };
  }

  if (parsed === null || !Array.isArray(parsed.characters)) {
    return { consolidated: [], failure: 'unparsed' };
  }

  const consolidated = parsed.characters.flatMap((entry): NoteConsolidatedLists[] => {
    const result = consolidatedListsSchema.safeParse(entry);

    return result.success
      ? [{ cardId: result.data.id, traits: result.data.traits, tags: result.data.tags }]
      : [];
  });

  return { consolidated };
}

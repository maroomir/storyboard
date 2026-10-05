import { z } from 'zod';

export const noteConsolidatedFields = [
  'aliases',
  'traits',
  'tags',
  'description',
  'voice',
  'desire',
  'senses',
] as const;

export type NoteConsolidatedField = (typeof noteConsolidatedFields)[number];

// A field missing here was not sent, or was left out of the answer; an empty list is an answer.
export type NoteConsolidatedValues = Partial<
  Readonly<Record<NoteConsolidatedField, readonly string[]>>
>;

// `readCount` is how many readings of the notes gave the alias to that card; a card on disk that
// already has it carries none.
export interface NoteAliasCarrier {
  readonly cardId: string;
  readonly name: string;
  readonly readCount?: number;
}

// An alias that another card carries too, as a candidate of its own or already on disk. Only the
// model can tell whose it is, so every card that proposes it is asked in the same request.
export interface NoteSharedAlias {
  readonly alias: string;
  readonly readCount: number;
  readonly otherCards: readonly NoteAliasCarrier[];
}

// A card whose lists came from more than one reading of the notes, which already has some of them,
// or which proposes an alias that needs a look. `existing` is what the card holds and is never
// proposed again; `candidates` are what the model narrows to one item per meaning.
export interface NoteConsolidationTarget {
  readonly cardId: string;
  readonly name: string;
  readonly type: 'character' | 'background';
  readonly existing: NoteConsolidatedValues;
  readonly candidates: NoteConsolidatedValues;
  readonly sharedAliases: readonly NoteSharedAlias[];
}

export interface NoteConsolidatedLists {
  readonly cardId: string;
  readonly values: NoteConsolidatedValues;
}

export type NoteConsolidationFailure = 'truncated' | 'unparsed';

export interface NoteConsolidationResult {
  readonly consolidated: readonly NoteConsolidatedLists[];
  readonly failure?: NoteConsolidationFailure;
}

const answerIdSchema = z.object({ id: z.string().trim().min(1) });

function readTextList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === 'string' && item.trim().length > 0 ? [item.trim()] : [],
      )
    : undefined;
}

function readAnswer(entry: unknown): NoteConsolidatedLists | undefined {
  const id = answerIdSchema.safeParse(entry);

  if (!id.success) {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const values: Partial<Record<NoteConsolidatedField, readonly string[]>> = {};

  for (const field of noteConsolidatedFields) {
    const list = readTextList(record[field]);

    if (list !== undefined) {
      values[field] = list;
    }
  }

  return { cardId: id.data.id, values };
}

export function readNoteConsolidationResponse(
  parsed: Record<string, unknown> | null,
  isTruncated: boolean,
): NoteConsolidationResult {
  if (isTruncated) {
    return { consolidated: [], failure: 'truncated' };
  }

  if (parsed === null || !Array.isArray(parsed.cards)) {
    return { consolidated: [], failure: 'unparsed' };
  }

  return {
    consolidated: parsed.cards.flatMap((entry) => {
      const answer = readAnswer(entry);
      return answer === undefined ? [] : [answer];
    }),
  };
}

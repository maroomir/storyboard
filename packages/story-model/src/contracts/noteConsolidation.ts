import { z } from 'zod';

export type NoteConsolidatedField = 'aliases' | 'traits' | 'tags' | 'description' | 'voice' | 'desire' | 'senses';

export const noteConsolidatedFields: readonly [NoteConsolidatedField, ...NoteConsolidatedField[]] = [
  'aliases',
  'traits',
  'tags',
  'description',
  'voice',
  'desire',
  'senses',
];

export type NoteConsolidatedValues = Partial<
  Readonly<Record<NoteConsolidatedField, readonly string[]>>
>;

export interface NoteAliasCarrier {
  readonly cardId: string;
  readonly name: string;
  readonly readCount?: number;
}

export interface NoteSharedAlias {
  readonly alias: string;
  readonly readCount: number;
  readonly otherCards: readonly NoteAliasCarrier[];
}

export interface NoteConsolidationTarget {
  readonly cardId: string;
  readonly name: string;
  readonly type: 'character' | 'background';
  readonly existing: NoteConsolidatedValues;
  readonly candidates: NoteConsolidatedValues;
  readonly sharedAliases: readonly NoteSharedAlias[];
}

export type NoteConsolidatedGroups = Partial<
  Readonly<Record<NoteConsolidatedField, readonly (readonly string[])[]>>
>;

export interface NoteConsolidationConflict {
  readonly field: NoteConsolidatedField;
  readonly items: readonly string[];
}

export interface NoteConsolidatedLists {
  readonly cardId: string;
  readonly values: NoteConsolidatedValues;
  readonly groups?: NoteConsolidatedGroups;
  readonly conflicts?: readonly NoteConsolidationConflict[];
}

export type NoteConsolidationFailure = 'truncated' | 'unparsed';

export interface NoteConsolidationResult {
  readonly consolidated: readonly NoteConsolidatedLists[];
  readonly failure?: NoteConsolidationFailure;
}

interface AnswerId {
  id: string;
}

const answerIdSchema: z.ZodType<AnswerId> = z.object({ id: z.string().trim().min(1) });

function readTextList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === 'string' && item.trim().length > 0 ? [item.trim()] : [],
      )
    : undefined;
}

function readGroups(value: unknown): string[][] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(Array.isArray)
    ? value.flatMap((group) => {
        const items: string[] = readTextList(group) ?? [];
        return items.length === 0 ? [] : [items];
      })
    : undefined;
}

function readConflicts(value: unknown): NoteConsolidationConflict[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const record: Record<string, unknown> = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const field: "tags" | "description" | "voice" | "aliases" | "traits" | "desire" | "senses" | undefined = noteConsolidatedFields.find((name) => name === record.field);
    const items: string[] = readTextList(record.items) ?? [];

    return field === undefined || items.length < 2 ? [] : [{ field, items }];
  });
}

function readAnswer(entry: unknown): NoteConsolidatedLists | undefined {
  const id: z.ZodSafeParseResult<AnswerId> = answerIdSchema.safeParse(entry);

  if (!id.success) {
    return undefined;
  }

  const record: Record<string, unknown> = entry as Record<string, unknown>;
  const values: Partial<Record<NoteConsolidatedField, readonly string[]>> = {};
  const groups: Partial<Record<NoteConsolidatedField, readonly (readonly string[])[]>> = {};

  for (const field of noteConsolidatedFields) {
    const fieldGroups: string[][] | undefined = readGroups(record[field]);
    const list: string[] | undefined = fieldGroups === undefined ? readTextList(record[field]) : undefined;

    if (fieldGroups !== undefined) {
      groups[field] = fieldGroups;
    } else if (list !== undefined) {
      values[field] = list;
    }
  }

  const conflicts: NoteConsolidationConflict[] = readConflicts(record.conflicts);

  return {
    cardId: id.data.id,
    values,
    ...(Object.keys(groups).length === 0 ? {} : { groups }),
    ...(conflicts.length === 0 ? {} : { conflicts }),
  };
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
      const answer: NoteConsolidatedLists | undefined = readAnswer(entry);
      return answer === undefined ? [] : [answer];
    }),
  };
}

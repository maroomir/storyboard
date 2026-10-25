import { z } from 'zod';

import { characterRoles } from '#model/format/card';
import type { AttributeCandidate, CharacterRole, RelationLink } from '#model/format/card';
import type { BibleSubjectKind } from '#model/format/bible';

export type NoteKind =
  | 'character'
  | 'background'
  | 'scene'
  | 'premise'
  | 'setting'
  | 'draft'
  | 'other';

export const noteKinds: readonly [NoteKind, ...NoteKind[]] = [
  'character',
  'background',
  'scene',
  'premise',
  'setting',
  'draft',
  'other',
];

export interface NoteExtractionNote {
  readonly id: string;
  readonly title: string;
  readonly path: readonly string[];
  readonly body: string;
}

export interface NoteExtractionKnownCard {
  readonly id: string;
  readonly type: BibleSubjectKind;
  readonly name: string;
  readonly aliases: readonly string[];
}

function emptyWhenMissing<Item>(schema: z.ZodType<Item[]>): z.ZodType<Item[]> {
  return schema.optional().transform((value) => value ?? []);
}

const optionalText: z.ZodPreprocess<z.ZodOptional<z.ZodString>> = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);

function textList(): z.ZodType<string[]> {
  return emptyWhenMissing(
    z.preprocess(
      (value) =>
        Array.isArray(value)
          ? value.filter((item) => typeof item === 'string' && item.trim().length > 0)
          : [],
      z.array(z.string().trim().min(1)),
    ),
  );
}

const annotatedAliasPattern: RegExp = /[()[\]{}（）［］｛｝【】〔〕]/;

function aliasList(): z.ZodType<string[]> {
  return textList().transform((aliases) =>
    aliases.filter((alias) => !annotatedAliasPattern.test(alias)),
  );
}

function recordList<Item>(item: z.ZodType<Item>): z.ZodType<Item[]> {
  return emptyWhenMissing(
    z.preprocess(
      (value) =>
        Array.isArray(value) ? value.filter((entry) => item.safeParse(entry).success) : [],
      z.array(item),
    ),
  );
}

export interface NoteClassification {
  id: string;
  kinds: NoteKind[];
}

const noteClassificationSchema: z.ZodType<NoteClassification> = z.object({
  id: z.string().trim().min(1),
  kinds: emptyWhenMissing(
    z.preprocess(
      (value) =>
        Array.isArray(value)
          ? value.filter((kind) => (noteKinds as readonly unknown[]).includes(kind))
          : [],
      z.array(z.enum(noteKinds)),
    ),
  ),
});

export interface NoteExtractionEntity {
  type: BibleSubjectKind;
  name: string;
  aliases: string[];
  tags: string[] | never[];
  traits: string[] | never[];
  description: string[] | never[];
  voice: string[] | never[];
  sampleLines: string[] | never[];
  desire: string[] | never[];
  attributes: AttributeCandidate[];
  relations: RelationLink[];
  canonFacts: AttributeCandidate[];
  senses: string[] | never[];
  characterNames: string[] | never[];
  sourceNotes: string[] | never[];
  suggestedId?: string;
  existingId?: string;
  role?: CharacterRole;
  time?: string;
  weather?: string;
}

const noteEntitySchema: z.ZodType<NoteExtractionEntity> = z.object({
  type: z.enum(['character', 'background']),
  name: z.string().trim().min(1),
  suggestedId: optionalText,
  existingId: optionalText,
  role: z.preprocess(
    (value) => ((characterRoles as readonly unknown[]).includes(value) ? value : undefined),
    z.enum(characterRoles).optional(),
  ),
  aliases: aliasList(),
  tags: textList(),
  traits: textList(),
  description: textList(),
  voice: textList(),
  sampleLines: textList(),
  desire: textList(),
  attributes: recordList(
    z.object({ key: z.string().trim().min(1), value: z.string().trim().min(1) }),
  ),
  relations: recordList(
    z.object({ target: z.string().trim().min(1), type: z.string().trim().min(1) }),
  ),
  canonFacts: recordList(
    z.object({ key: z.string().trim().min(1), value: z.string().trim().min(1) }),
  ),
  senses: textList(),
  time: optionalText,
  weather: optionalText,
  characterNames: textList(),
  sourceNotes: textList(),
});

export interface NoteExtractionScene {
  title: string;
  summary: string;
  beats: string[] | never[];
  characterNames: string[] | never[];
  slug?: string;
  locationName?: string;
  mood?: string;
  purpose?: string;
  sourceNote?: string;
}

const noteSceneSchema: z.ZodType<NoteExtractionScene> = z.object({
  title: z.string().trim().min(1),
  slug: optionalText,
  summary: z.string().trim().min(1),
  beats: textList(),
  characterNames: textList(),
  locationName: optionalText,
  mood: optionalText,
  purpose: optionalText,
  sourceNote: optionalText,
});

export interface NoteExtraction {
  readonly notes: readonly NoteClassification[];
  readonly entities: readonly NoteExtractionEntity[];
  readonly scenes: readonly NoteExtractionScene[];
  readonly premise: readonly string[];
}

function salvageList<T>(value: unknown, schema: z.ZodType<T>): T[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const parsed: z.ZodSafeParseResult<T> = schema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
}

export type NoteResponseFailure = 'truncated' | 'unparsed';

export interface NoteExtractionResult {
  readonly extraction: NoteExtraction;
  readonly responseText: string;
  readonly failure?: NoteResponseFailure;
}

export interface NoteExtractionResponse {
  readonly chunk: number;
  readonly noteIds: readonly string[];
  readonly failure?: NoteResponseFailure;
  readonly text: string;
}

const extractionKeys: readonly string[] = ['notes', 'entities', 'scenes', 'premise'];

export function readNoteExtractionResponse(
  responseText: string,
  parsed: Record<string, unknown> | null,
  isTruncated: boolean,
): NoteExtractionResult {
  const failure: NoteResponseFailure | undefined = isTruncated
    ? 'truncated'
    : parsed === null || !extractionKeys.some((key) => key in parsed)
      ? 'unparsed'
      : undefined;

  return failure === undefined
    ? { extraction: coerceNoteExtraction(parsed), responseText }
    : { extraction: coerceNoteExtraction(null), responseText, failure };
}

export function coerceNoteExtraction(value: Record<string, unknown> | null): NoteExtraction {
  return {
    notes: salvageList(value?.notes, noteClassificationSchema),
    entities: salvageList(value?.entities, noteEntitySchema),
    scenes: salvageList(value?.scenes, noteSceneSchema),
    premise: textList().parse(value?.premise),
  };
}

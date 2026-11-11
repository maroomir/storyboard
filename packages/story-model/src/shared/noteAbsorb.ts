import { z } from 'zod';

export type NoteSourceKind = 'obsidian' | 'notion' | 'notion-export';

export const noteSourceKinds: readonly [NoteSourceKind, ...NoteSourceKind[]] = [
  'obsidian',
  'notion',
  'notion-export',
];

export type NoteOrigin = 'tree' | 'link';

export const noteOrigins: readonly [NoteOrigin, ...NoteOrigin[]] = ['tree', 'link'];

export interface NoteDocument {
  id: string;
  title: string;
  path: string[];
  body: string;
  origin: NoteOrigin;
}

export const noteDocumentSchema: z.ZodType<NoteDocument> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  path: z.array(z.string()),
  body: z.string(),
  origin: z.enum(noteOrigins),
});

export interface SkippedNote {
  label: string;
  reason: string;
}

export const skippedNoteSchema: z.ZodType<SkippedNote> = z.object({
  label: z.string().min(1),
  reason: z.string().min(1),
});

export interface NoteBundle {
  kind: NoteSourceKind;
  location: string;
  collectedAt: string;
  notes: NoteDocument[];
  skipped: SkippedNote[];
}

export const noteBundleSchema: z.ZodType<NoteBundle> = z.object({
  kind: z.enum(noteSourceKinds),
  location: z.string().min(1),
  collectedAt: z.string().datetime(),
  notes: z.array(noteDocumentSchema),
  skipped: z.array(skippedNoteSchema),
});


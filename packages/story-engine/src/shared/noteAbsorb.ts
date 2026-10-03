import { z } from 'zod';

export const noteSourceKinds = ['obsidian', 'notion'] as const;

export type NoteSourceKind = (typeof noteSourceKinds)[number];

// 'tree' 는 준 페이지와 그 아래에 있던 노트, 'link' 는 본문 링크를 한 단계 따라가 읽은 노트다.
export const noteOrigins = ['tree', 'link'] as const;

export type NoteOrigin = (typeof noteOrigins)[number];

export const noteDocumentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  path: z.array(z.string()),
  body: z.string(),
  origin: z.enum(noteOrigins),
});

export const skippedNoteSchema = z.object({
  label: z.string().min(1),
  reason: z.string().min(1),
});

export const noteBundleSchema = z.object({
  kind: z.enum(noteSourceKinds),
  location: z.string().min(1),
  collectedAt: z.string().datetime(),
  notes: z.array(noteDocumentSchema),
  skipped: z.array(skippedNoteSchema),
});

export type NoteDocument = z.infer<typeof noteDocumentSchema>;
export type SkippedNote = z.infer<typeof skippedNoteSchema>;
export type NoteBundle = z.infer<typeof noteBundleSchema>;

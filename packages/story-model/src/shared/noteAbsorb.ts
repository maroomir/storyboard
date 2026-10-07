import { z } from 'zod';

import { cardCollectProposalSchema } from './cardCollect';

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

// What a note had to say about a card that already exists. It waits in the cache until
// `card promote` lays it over the card, the same way facts from a draft wait.
export const noteCardCandidateSchema = z.object({
  cardId: z.string().min(1),
  cardType: z.enum(['character', 'background']),
  name: z.string().min(1),
  sourceNotes: z.array(z.string()),
  changes: z.array(cardCollectProposalSchema),
});

// One absorb's candidates. Absorbing the same location again replaces its source, so a re-read is
// idempotent; other locations keep theirs until promoted or discarded.
export const noteCandidateSourceSchema = z.object({
  id: z.string().regex(/^s\d+$/),
  location: z.string().min(1),
  absorbedAt: z.string().datetime(),
  candidates: z.array(noteCardCandidateSchema),
});

export const noteCandidateFileSchema = z.object({
  version: z.literal(2),
  sources: z.array(noteCandidateSourceSchema),
});

export type NoteCardCandidate = z.infer<typeof noteCardCandidateSchema>;
export type NoteCandidateSource = z.infer<typeof noteCandidateSourceSchema>;
export type NoteCandidateFile = z.infer<typeof noteCandidateFileSchema>;

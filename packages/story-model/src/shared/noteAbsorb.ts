import { z } from 'zod';

import { cardCollectProposalSchema, type CardCollectProposal } from '#model/shared/cardCollect';
import type { BibleSubjectKind } from '#model/format/bible';

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

export interface NoteCardCandidate {
  cardId: string;
  cardType: BibleSubjectKind;
  name: string;
  sourceNotes: string[];
  changes: CardCollectProposal[];
}

export const noteCardCandidateSchema: z.ZodType<NoteCardCandidate> = z.object({
  cardId: z.string().min(1),
  cardType: z.enum(['character', 'background']),
  name: z.string().min(1),
  sourceNotes: z.array(z.string()),
  changes: z.array(cardCollectProposalSchema),
});

export interface NoteCandidateSource {
  id: string;
  location: string;
  absorbedAt: string;
  candidates: NoteCardCandidate[];
}

export const noteCandidateSourceSchema: z.ZodType<NoteCandidateSource> = z.object({
  id: z.string().regex(/^s\d+$/),
  location: z.string().min(1),
  absorbedAt: z.string().datetime(),
  candidates: z.array(noteCardCandidateSchema),
});

export interface NoteCandidateFile {
  version: 2;
  sources: NoteCandidateSource[];
}

export const noteCandidateFileSchema: z.ZodType<NoteCandidateFile> = z.object({
  version: z.literal(2),
  sources: z.array(noteCandidateSourceSchema),
});

import { z } from 'zod';

import { cardCollectProposalSchema, type CardCollectProposal } from './cardCollect';

// 'notion-export' 는 Notion 의 «Markdown & CSV» 내보내기 zip — 통합 토큰 없이 읽는 길이다.
export const noteSourceKinds = ['obsidian', 'notion', 'notion-export'] as const;

export type NoteSourceKind = (typeof noteSourceKinds)[number];

// 'tree' 는 준 페이지와 그 아래에 있던 노트, 'link' 는 본문 링크를 한 단계 따라가 읽은 노트다.
export const noteOrigins = ['tree', 'link'] as const;

export type NoteOrigin = (typeof noteOrigins)[number];

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

// What a note had to say about a card that already exists. It waits in the cache until
// `card promote` lays it over the card, the same way facts from a draft wait.
export interface NoteCardCandidate {
  cardId: string;
  cardType: 'character' | 'background';
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

// One absorb's candidates. Absorbing the same location again replaces its source, so a re-read is
// idempotent; other locations keep theirs until promoted or discarded.
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

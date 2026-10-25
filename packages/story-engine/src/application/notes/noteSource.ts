import type { StoryUri, NoteDocument, NoteSourceKind, SkippedNote } from '@storyboard/story-model';


export type NoteLocation =
  | { readonly kind: 'obsidian'; readonly root: StoryUri }
  | { readonly kind: 'notion'; readonly pageUrl: string }
  | { readonly kind: 'notion-export'; readonly archive: StoryUri };

export interface CollectedNotes {
  readonly notes: readonly NoteDocument[];
  readonly skipped: readonly SkippedNote[];
}

export interface INoteSource {
  readonly kind: NoteSourceKind;
  collect(): Promise<CollectedNotes>;
}

export interface INoteSourceProvider {
  open(location: NoteLocation): Promise<INoteSource>;
}

export type NoteSourceErrorCode =
  | 'not-found'
  | 'not-a-page'
  | 'missing-token'
  | 'unauthorized'
  | 'invalid-location'
  | 'request-failed';

export class NoteSourceError extends Error {
  public constructor(
    public readonly code: NoteSourceErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NoteSourceError';
  }
}

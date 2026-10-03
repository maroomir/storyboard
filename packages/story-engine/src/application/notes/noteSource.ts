import type { StoryUri, NoteDocument, NoteSourceKind, SkippedNote } from '@storyboard/story-model';


// Where the author keeps their notes. A vault is a folder (or one note) on disk; a Notion page is
// reached over the network with the integration token from the secret store.
export type NoteLocation =
  | { readonly kind: 'obsidian'; readonly root: StoryUri }
  | { readonly kind: 'notion'; readonly pageUrl: string };

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

import { posix } from 'node:path';

// The structural shape every host's URI already has. It mirrors `vscode.Uri` member for member so
// the two are interchangeable in both directions: the extension can hand a real `vscode.Uri` to the
// engine, and an engine-derived path goes straight back into a VSCode API with no conversion. A
// Node host satisfies the same shape without pulling in an editor.
export interface StoryUri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
  readonly fsPath: string;
  with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): StoryUri;
  toString(skipEncoding?: boolean): string;
  toJSON(): unknown;
}

export interface StoryWorkspaceFolder {
  readonly uri: StoryUri;
  readonly name: string;
}

// NOTE: `with()` is the polymorphic constructor — the result is the same concrete class the caller
// passed in, which is why no boundary has to convert. Joining on `path` with posix semantics is
// exactly what `vscode.Uri.joinPath` does.
export function joinStoryPath(base: StoryUri, ...segments: string[]): StoryUri {
  return base.with({ path: posix.join(base.path, ...segments) });
}

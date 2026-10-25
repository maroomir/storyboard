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

function joinPosixPath(segments: readonly string[]): string {
  const joined: string = segments.filter((segment) => segment.length > 0).join('/');

  if (joined.length === 0) {
    return '.';
  }

  const isAbsolute: boolean = joined.startsWith('/');
  const hasTrailingSlash: boolean = joined.endsWith('/');
  const resolved: string[] = [];

  for (const part of joined.split('/')) {
    if (part.length === 0 || part === '.') {
      continue;
    }

    if (part !== '..') {
      resolved.push(part);
      continue;
    }

    const last: string | undefined = resolved[resolved.length - 1];

    if (last !== undefined && last !== '..') {
      resolved.pop();
    } else if (!isAbsolute) {
      resolved.push('..');
    }
  }

  const body: string = resolved.join('/');
  const trailing: string = hasTrailingSlash && body.length > 0 ? '/' : '';

  if (isAbsolute) {
    return `/${body}${trailing}`;
  }

  return body.length > 0 ? `${body}${trailing}` : '.';
}

export function joinStoryPath(base: StoryUri, ...segments: string[]): StoryUri {
  return base.with({ path: joinPosixPath([base.path, ...segments]) });
}

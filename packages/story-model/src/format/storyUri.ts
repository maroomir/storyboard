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

// NOTE: node:path 를 쓰지 않는다. story-model 은 브라우저 번들에도 실리는 런타임 중립 패키지라,
// 여기서 node 모듈을 하나만 끌어와도 웹뷰 빌드가 통째로 깨진다. 동작은 posix.join 과 같아야 하므로
// storyUri.spec 이 표준 라이브러리와 결과를 대조한다.
function joinPosixPath(segments: readonly string[]): string {
  const joined = segments.filter((segment) => segment.length > 0).join('/');

  if (joined.length === 0) {
    return '.';
  }

  const isAbsolute = joined.startsWith('/');
  const hasTrailingSlash = joined.endsWith('/');
  const resolved: string[] = [];

  for (const part of joined.split('/')) {
    if (part.length === 0 || part === '.') {
      continue;
    }

    if (part !== '..') {
      resolved.push(part);
      continue;
    }

    const last = resolved[resolved.length - 1];

    if (last !== undefined && last !== '..') {
      resolved.pop();
    } else if (!isAbsolute) {
      resolved.push('..');
    }
  }

  const body = resolved.join('/');
  const trailing = hasTrailingSlash && body.length > 0 ? '/' : '';

  if (isAbsolute) {
    return `/${body}${trailing}`;
  }

  return body.length > 0 ? `${body}${trailing}` : '.';
}

// NOTE: `with()` is the polymorphic constructor — the result is the same concrete class the caller
// passed in, which is why no boundary has to convert. Joining on `path` with posix semantics is
// exactly what `vscode.Uri.joinPath` does.
export function joinStoryPath(base: StoryUri, ...segments: string[]): StoryUri {
  return base.with({ path: joinPosixPath([base.path, ...segments]) });
}

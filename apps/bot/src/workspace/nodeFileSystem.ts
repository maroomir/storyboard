import { readFile, writeFile } from 'node:fs/promises';

// The story-format codecs take a filesystem port whose `uri` is opaque (`unknown`) so the VSCode
// extension can pass a vscode.Uri. Headless clients pass an absolute path string instead.
export interface NodeStoryFileSystem {
  readonly readFile: (uri: unknown) => Promise<Uint8Array>;
  readonly writeFile: (uri: unknown, content: Uint8Array) => Promise<void>;
}

function toPath(uri: unknown): string {
  if (typeof uri !== 'string') {
    throw new TypeError(`Expected an absolute path string, received ${typeof uri}`);
  }
  return uri;
}

export function createNodeStoryFileSystem(): NodeStoryFileSystem {
  return {
    readFile: async (uri) => new Uint8Array(await readFile(toPath(uri))),
    writeFile: async (uri, content) => {
      await writeFile(toPath(uri), content);
    },
  };
}

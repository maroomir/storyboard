import { isAbsolute, resolve, sep } from 'node:path';

import type { StoryUri } from '@storyboard/story-engine';

const isWindows = sep === '\\';

// A file URI for a host with no editor. `path` is always posix so the engine's path joining behaves
// identically everywhere; `fsPath` converts back to what Node's fs expects.
export class NodeUri implements StoryUri {
  public readonly scheme = 'file';
  public readonly authority = '';
  public readonly query = '';
  public readonly fragment = '';

  private constructor(public readonly path: string) {}

  public static file(osPath: string): NodeUri {
    const absolute = isAbsolute(osPath) ? osPath : resolve(osPath);
    const posix = absolute.split(sep).join('/');
    return new NodeUri(posix.startsWith('/') ? posix : `/${posix}`);
  }

  public get fsPath(): string {
    if (!isWindows) {
      return this.path;
    }
    return this.path.replace(/^\//, '').split('/').join('\\');
  }

  public with(change: { readonly path?: string }): NodeUri {
    return change.path === undefined ? this : new NodeUri(change.path);
  }

  public toString(): string {
    return `file://${this.path}`;
  }

  public toJSON(): unknown {
    return { scheme: this.scheme, path: this.path };
  }
}

import type { StoryUri } from '@storyboard/story-model';

export type FileSystemDirectoryEntry = [string, { type: 'file' | 'directory' }];

// What the engine needs from a host's file system. `StoryUri` is the same shape every host's URI
// already has, so an adapter reads `.fsPath` directly instead of casting an opaque value.
export interface IFileSystem {
  readFile(uri: StoryUri): Promise<Uint8Array>;
  writeFile(uri: StoryUri, content: Uint8Array): Promise<void>;
  createDirectory(uri: StoryUri): Promise<void>;
  exists(uri: StoryUri): Promise<boolean>;
  listFileNames(uri: StoryUri): Promise<readonly string[]>;
  readDirectory(uri: StoryUri): Promise<FileSystemDirectoryEntry[]>;
  delete(uri: StoryUri): Promise<void>;
  // Epoch milliseconds of the last write, or 0 when the file is missing or the host cannot tell.
  // Never throws — a caller distinguishes "missing" by the 0, not by catching.
  modifiedTime(uri: StoryUri): Promise<number>;
  // Whether `uri`, with every symbolic link resolved, still lies under `root` resolved the same way.
  isRealPathInside(uri: StoryUri, root: StoryUri): Promise<boolean>;
}

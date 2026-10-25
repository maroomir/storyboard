import type { StoryUri } from '@storyboard/story-model';

export type FileSystemDirectoryEntry = [string, { type: 'file' | 'directory' }];

export interface IFileSystem {
  readFile(uri: StoryUri): Promise<Uint8Array>;
  writeFile(uri: StoryUri, content: Uint8Array): Promise<void>;
  createDirectory(uri: StoryUri): Promise<void>;
  exists(uri: StoryUri): Promise<boolean>;
  listFileNames(uri: StoryUri): Promise<readonly string[]>;
  readDirectory(uri: StoryUri): Promise<FileSystemDirectoryEntry[]>;
  delete(uri: StoryUri): Promise<void>;
  modifiedTime(uri: StoryUri): Promise<number>;
  isRealPathInside(uri: StoryUri, root: StoryUri): Promise<boolean>;
}

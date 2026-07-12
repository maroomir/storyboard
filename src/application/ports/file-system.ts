export type FileSystemDirectoryEntry = [string, { type: 'file' | 'directory' }];

export interface IFileSystem {
  readFile(uri: unknown): Promise<Uint8Array>;
  writeFile(uri: unknown, content: Uint8Array): Promise<void>;
  createDirectory(uri: unknown): Promise<void>;
  exists(uri: unknown): Promise<boolean>;
  listFileNames(uri: unknown): Promise<readonly string[]>;
  readDirectory(uri: unknown): Promise<FileSystemDirectoryEntry[]>;
}

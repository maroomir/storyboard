export type FileSystemDirectoryEntry = [string, { type: 'file' | 'directory' }];

// What the engine needs from a host's file system. `uri` stays opaque: the engine only ever hands
// back a value the host itself produced through the path helpers, so each host reads it as its own
// URI type without a conversion.
export interface IFileSystem {
  readFile(uri: unknown): Promise<Uint8Array>;
  writeFile(uri: unknown, content: Uint8Array): Promise<void>;
  createDirectory(uri: unknown): Promise<void>;
  exists(uri: unknown): Promise<boolean>;
  listFileNames(uri: unknown): Promise<readonly string[]>;
  readDirectory(uri: unknown): Promise<FileSystemDirectoryEntry[]>;
  delete(uri: unknown): Promise<void>;
  // Epoch milliseconds of the last write, or 0 when the host cannot tell. Sidebars sort by it.
  modifiedTime(uri: unknown): Promise<number>;
}

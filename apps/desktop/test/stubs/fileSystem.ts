import type { FileSystemDirectoryEntry, IFileSystem } from "@storyboard/story-engine"

import { FileType, workspace, type UriLike } from "./vscode"

// The engine takes its file system by injection, so a spec that used to lean on the ambient
// `workspace.fs` stub passes this adapter instead. It stays a thin view over that same stub, so
// tests keep configuring behaviour the way they always have.
export const stubFileSystem: IFileSystem = {
  readFile: (uri) => workspace.fs.readFile(uri as UriLike),
  writeFile: (uri, content) => workspace.fs.writeFile(uri as UriLike, content),
  createDirectory: (uri) => workspace.fs.createDirectory(uri as UriLike),
  exists: async (uri) => {
    try {
      await workspace.fs.stat(uri as UriLike)
      return true
    } catch {
      return false
    }
  },
  listFileNames: async (uri) => {
    const entries = await workspace.fs.readDirectory(uri as UriLike)
    return entries.filter(([, type]) => type === FileType.File).map(([name]) => name)
  },
  readDirectory: async (uri): Promise<FileSystemDirectoryEntry[]> => {
    const entries = await workspace.fs.readDirectory(uri as UriLike)
    return entries.map(([name, type]) => [
      name,
      { type: type === FileType.Directory ? ("directory" as const) : ("file" as const) }
    ])
  },
  delete: (uri) => workspace.fs.delete(uri as UriLike),
  modifiedTime: async (uri) => (await workspace.fs.stat(uri as UriLike)).mtime ?? 0
}

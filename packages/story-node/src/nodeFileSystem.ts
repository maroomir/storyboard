import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import type { FileSystemDirectoryEntry, IFileSystem, StoryUri } from '@storyboard/story-engine';

// NOTE: a truncating write leaves a half-file behind when the process dies mid-draft, and a
// truncated draft is silently dropped by manuscript assembly. Write to a sibling and rename, the
// same rule the extension's atomic write follows.
async function writeAtomically(target: string, content: Uint8Array): Promise<void> {
  const temporary = `${target}.tmp-${Date.now().toString(36)}`;

  try {
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export class NodeFileSystem implements IFileSystem {
  public async readFile(uri: StoryUri): Promise<Uint8Array> {
    return await fs.readFile(pathOf(uri));
  }

  public async writeFile(uri: StoryUri, content: Uint8Array): Promise<void> {
    await writeAtomically(pathOf(uri), content);
  }

  public async createDirectory(uri: StoryUri): Promise<void> {
    await fs.mkdir(pathOf(uri), { recursive: true });
  }

  public async exists(uri: StoryUri): Promise<boolean> {
    try {
      await fs.stat(pathOf(uri));
      return true;
    } catch {
      return false;
    }
  }

  public async listFileNames(uri: StoryUri): Promise<readonly string[]> {
    const entries = await fs.readdir(pathOf(uri), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  public async readDirectory(uri: StoryUri): Promise<FileSystemDirectoryEntry[]> {
    const entries = await fs.readdir(pathOf(uri), { withFileTypes: true });
    return entries.map((entry) => [
      entry.name,
      { type: entry.isDirectory() ? ('directory' as const) : ('file' as const) },
    ]);
  }

  public async delete(uri: StoryUri): Promise<void> {
    await fs.rm(pathOf(uri), { recursive: true, force: true });
  }

  public async modifiedTime(uri: StoryUri): Promise<number> {
    try {
      return (await fs.stat(pathOf(uri))).mtimeMs;
    } catch {
      return 0;
    }
  }

  public async isRealPathInside(uri: StoryUri, root: StoryUri): Promise<boolean> {
    const [realTarget, realRoot] = await Promise.all([
      fs.realpath(pathOf(uri)),
      fs.realpath(pathOf(root)),
    ]);
    const fromRoot = relative(realRoot, realTarget);

    return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
  }
}

function pathOf(uri: StoryUri): string {
  return uri.fsPath;
}

export { join };

import { describe, expect, it } from 'vitest';

import type { FileSystemDirectoryEntry, IFileSystem, StoryUri } from '@storyboard/story-engine';
import { getStoryboardProjectPaths, migrateLegacyMemory } from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-format';

const workspaceRoot = NodeUri.file('/workspace');

class InMemoryFileSystem implements IFileSystem {
  private readonly files = new Map<string, string>();

  public constructor(seed: Record<string, string>) {
    for (const [path, content] of Object.entries(seed)) {
      this.files.set(`/workspace/${path}`, content);
    }
  }

  public snapshot(): Record<string, string> {
    return Object.fromEntries(
      [...this.files].map(([path, content]) => [path.replace('/workspace/', ''), content]),
    );
  }

  public async readFile(uri: StoryUri): Promise<Uint8Array> {
    const content = this.files.get(uri.fsPath);

    if (content === undefined) {
      throw new Error(`File not found: ${uri.fsPath}`);
    }

    return new TextEncoder().encode(content);
  }

  public async writeFile(uri: StoryUri, content: Uint8Array): Promise<void> {
    this.files.set(uri.fsPath, new TextDecoder().decode(content));
  }

  public async createDirectory(): Promise<void> {
    return undefined;
  }

  public async exists(uri: StoryUri): Promise<boolean> {
    return (
      this.files.has(uri.fsPath) ||
      [...this.files.keys()].some((path) => path.startsWith(`${uri.fsPath}/`))
    );
  }

  public async listFileNames(uri: StoryUri): Promise<readonly string[]> {
    return (await this.readDirectory(uri)).map(([name]) => name);
  }

  public async readDirectory(uri: StoryUri): Promise<FileSystemDirectoryEntry[]> {
    const prefix = `${uri.fsPath}/`;

    return [...this.files.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map((path) => [path.slice(prefix.length), { type: 'file' as const }]);
  }

  public async delete(uri: StoryUri): Promise<void> {
    this.files.delete(uri.fsPath);
  }

  public async modifiedTime(): Promise<number> {
    return 0;
  }

  public async isRealPathInside(): Promise<boolean> {
    return true;
  }
}

function migrate(fileSystem: InMemoryFileSystem): ReturnType<typeof migrateLegacyMemory> {
  return migrateLegacyMemory(fileSystem, getStoryboardProjectPaths(workspaceRoot));
}

describe('migrateLegacyMemory', () => {
  it('moves every legacy memory location under .storyboard/memory/', async () => {
    const fileSystem = new InMemoryFileSystem({
      '.storyboard/cache/storyState.md': '상태',
      '.storyboard/cache/personas/elia.json': '{"persona":1}',
      '.storyboard/cache/backgrounds/school.json': '{"background":1}',
      '.storyboard/cache/dialogue/01-prologue.json': '{"dialogue":1}',
      'manuscript/SUMMARY.md': '요약',
    });

    const { movedPaths } = await migrate(fileSystem);

    expect(fileSystem.snapshot()).toEqual({
      '.storyboard/memory/storyState.md': '상태',
      '.storyboard/memory/personas/elia.json': '{"persona":1}',
      '.storyboard/memory/backgrounds/school.json': '{"background":1}',
      '.storyboard/memory/dialogue/01-prologue.json': '{"dialogue":1}',
      '.storyboard/memory/summaries.md': '요약',
    });
    expect([...movedPaths].sort()).toEqual([
      '.storyboard/memory/backgrounds/school.json',
      '.storyboard/memory/dialogue/01-prologue.json',
      '.storyboard/memory/personas/elia.json',
      '.storyboard/memory/storyState.md',
      '.storyboard/memory/summaries.md',
    ]);
  });

  it('keeps the current memory and drops the legacy copy when both exist', async () => {
    const fileSystem = new InMemoryFileSystem({
      '.storyboard/cache/storyState.md': '옛 상태',
      '.storyboard/memory/storyState.md': '새 상태',
    });

    const { movedPaths } = await migrate(fileSystem);

    expect(fileSystem.snapshot()).toEqual({ '.storyboard/memory/storyState.md': '새 상태' });
    expect(movedPaths).toEqual([]);
  });

  it('reports nothing on a second run', async () => {
    const fileSystem = new InMemoryFileSystem({
      '.storyboard/cache/storyState.md': '상태',
      '.storyboard/cache/personas/elia.json': '{"persona":1}',
    });

    await migrate(fileSystem);
    const { movedPaths } = await migrate(fileSystem);

    expect(movedPaths).toEqual([]);
  });

  it('leaves a workspace with no legacy memory untouched', async () => {
    const fileSystem = new InMemoryFileSystem({ 'draft/01-prologue.md': '본문' });

    const { movedPaths } = await migrate(fileSystem);

    expect(fileSystem.snapshot()).toEqual({ 'draft/01-prologue.md': '본문' });
    expect(movedPaths).toEqual([]);
  });
});

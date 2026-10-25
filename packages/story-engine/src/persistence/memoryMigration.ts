import { STORYBOARD_RELATIVE_PATHS, joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { StoryboardProjectPaths } from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';

interface LegacyMemoryMove {
  readonly legacy: string;
  readonly current: string;
}

const legacyMemoryLocations: readonly LegacyMemoryMove[] = [
  { legacy: '.storyboard/cache/storyState.md', current: STORYBOARD_RELATIVE_PATHS.storyState },
  { legacy: 'manuscript/SUMMARY.md', current: STORYBOARD_RELATIVE_PATHS.chapterSummaries },
];

const legacyMemoryDirectories: readonly LegacyMemoryMove[] = [
  {
    legacy: '.storyboard/cache/dialogue',
    current: STORYBOARD_RELATIVE_PATHS.sceneDialogueDirectory,
  },
  {
    legacy: '.storyboard/cache/personas',
    current: STORYBOARD_RELATIVE_PATHS.personaMemoryDirectory,
  },
  {
    legacy: '.storyboard/cache/backgrounds',
    current: STORYBOARD_RELATIVE_PATHS.backgroundMemoryDirectory,
  },
];

export interface MemoryMigrationResult {
  readonly movedPaths: readonly string[];
}

export async function migrateLegacyMemory(
  fileSystem: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<MemoryMigrationResult> {
  const workspaceRoot: StoryUri = paths.workspaceRoot;
  const movedPaths: string[] = [];

  for (const location of legacyMemoryLocations) {
    const legacyUri: StoryUri = resolve(workspaceRoot, location.legacy);
    if (!(await fileSystem.exists(legacyUri))) {
      continue;
    }

    const currentUri: StoryUri = resolve(workspaceRoot, location.current);
    if (!(await fileSystem.exists(currentUri))) {
      await fileSystem.createDirectory(paths.memoryDirectory);
      await fileSystem.writeFile(currentUri, await fileSystem.readFile(legacyUri));
      movedPaths.push(location.current);
    }

    await fileSystem.delete(legacyUri);
  }

  for (const location of legacyMemoryDirectories) {
    const legacyUri: StoryUri = resolve(workspaceRoot, location.legacy);
    if (!(await fileSystem.exists(legacyUri))) {
      continue;
    }

    const currentUri: StoryUri = resolve(workspaceRoot, location.current);
    movedPaths.push(
      ...(await moveDirectoryFiles(fileSystem, legacyUri, currentUri, location.current)),
    );
    await fileSystem.delete(legacyUri);
  }

  return { movedPaths };
}

async function moveDirectoryFiles(
  fileSystem: IFileSystem,
  legacyUri: StoryUri,
  currentUri: StoryUri,
  currentRelativePath: string,
): Promise<string[]> {
  const entries: FileSystemDirectoryEntry[] = await fileSystem.readDirectory(legacyUri);
  const fileNames: string[] = entries
    .filter(([, stat]) => stat.type === 'file')
    .map(([name]) => name);
  if (fileNames.length === 0) {
    return [];
  }

  await fileSystem.createDirectory(currentUri);

  const moved: string[] = [];
  for (const fileName of fileNames) {
    const legacyFileUri: StoryUri = joinStoryPath(legacyUri, fileName);
    const targetUri: StoryUri = joinStoryPath(currentUri, fileName);

    if (!(await fileSystem.exists(targetUri))) {
      await fileSystem.writeFile(targetUri, await fileSystem.readFile(legacyFileUri));
      moved.push(`${currentRelativePath}/${fileName}`);
    }

    await fileSystem.delete(legacyFileUri);
  }

  return moved;
}

function resolve(workspaceRoot: StoryUri, relativePath: string): StoryUri {
  return joinStoryPath(workspaceRoot, ...relativePath.split('/'));
}

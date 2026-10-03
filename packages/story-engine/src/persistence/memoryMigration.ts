import { STORYBOARD_RELATIVE_PATHS, joinStoryPath, type StoryUri } from '@storyboard/story-model';
import type { StoryboardProjectPaths } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';

// NOTE: `.storyboard/memory/` used to live under `.storyboard/cache/`, which the scaffold
// gitignores. Everything moved here is LLM output that no committed input can reproduce, so it
// belongs in version control. Workspaces created before the move are migrated when they open.
const legacyMemoryLocations = [
  { legacy: '.storyboard/cache/storyState.md', current: STORYBOARD_RELATIVE_PATHS.storyState },
  { legacy: 'manuscript/SUMMARY.md', current: STORYBOARD_RELATIVE_PATHS.chapterSummaries },
] as const;

const legacyMemoryDirectories = [
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
] as const;

export interface MemoryMigrationResult {
  // Workspace-relative paths written at the new location, for a host that has to commit them.
  readonly movedPaths: readonly string[];
}

// Idempotent: a memory already present at its current location is kept and its legacy copy removed,
// so the workspace never holds two versions of one memory. Legacy locations were gitignored, so a
// host committing the result only has to add the returned paths.
export async function migrateLegacyMemory(
  fileSystem: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<MemoryMigrationResult> {
  const workspaceRoot = paths.workspaceRoot;
  const movedPaths: string[] = [];

  for (const location of legacyMemoryLocations) {
    const legacyUri = resolve(workspaceRoot, location.legacy);
    if (!(await fileSystem.exists(legacyUri))) {
      continue;
    }

    const currentUri = resolve(workspaceRoot, location.current);
    if (!(await fileSystem.exists(currentUri))) {
      await fileSystem.createDirectory(paths.memoryDirectory);
      await fileSystem.writeFile(currentUri, await fileSystem.readFile(legacyUri));
      movedPaths.push(location.current);
    }

    await fileSystem.delete(legacyUri);
  }

  for (const location of legacyMemoryDirectories) {
    const legacyUri = resolve(workspaceRoot, location.legacy);
    if (!(await fileSystem.exists(legacyUri))) {
      continue;
    }

    const currentUri = resolve(workspaceRoot, location.current);
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
  const entries = await fileSystem.readDirectory(legacyUri);
  const fileNames = entries.filter(([, stat]) => stat.type === 'file').map(([name]) => name);
  if (fileNames.length === 0) {
    return [];
  }

  await fileSystem.createDirectory(currentUri);

  // Each legacy file is removed as it is copied so the directory is empty by the time the caller
  // deletes it — a host whose delete is non-recursive would otherwise fail on a full directory.
  const moved: string[] = [];
  for (const fileName of fileNames) {
    const legacyFileUri = joinStoryPath(legacyUri, fileName);
    const targetUri = joinStoryPath(currentUri, fileName);

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

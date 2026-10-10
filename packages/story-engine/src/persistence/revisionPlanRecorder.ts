import type { StoryUri } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ReviseRound } from '#engine/pipeline/reviseLoop';
import {
  joinStoryPath,
  type StoryboardProjectPaths,
  createEmptyRevisionPlan,
  readRevisionPlanFile,
  type RevisionPlan,
  type RevisionPlanEntry,
  upsertRevisionEntry,
  writeRevisionPlanFile,
} from '@storyboard/story-model';

export async function recordRevisionEntry(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  entry: RevisionPlanEntry,
): Promise<void> {
  const current = await readRevisionPlanOrEmpty(fs, paths.outlineRevisionPlan);
  const next = upsertRevisionEntry(current, entry);

  await fs.createDirectory(paths.outlineDirectory);
  await writeRevisionPlanFile(paths.outlineRevisionPlan, fs, next);
}

async function readRevisionPlanOrEmpty(fs: IFileSystem, uri: StoryUri): Promise<RevisionPlan> {
  if (!(await fs.exists(uri))) {
    return createEmptyRevisionPlan();
  }

  try {
    return await readRevisionPlanFile(uri, fs);
  } catch {
    return createEmptyRevisionPlan();
  }
}

// The rounds of the latest review of one scene, next to the scene cache (git-ignored). The plan file
// keeps only the last round's instructions; this is where an earlier round can be read back.
export async function recordRevisionRounds(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
  sceneStem: string,
  rounds: readonly ReviseRound[],
): Promise<void> {
  await fs.createDirectory(paths.revisionRoundsDirectory);
  await fs.writeFile(
    joinStoryPath(paths.revisionRoundsDirectory, `${sceneStem}.json`),
    new TextEncoder().encode(
      `${JSON.stringify({ sceneStem, checkedAt: new Date().toISOString(), rounds }, null, 2)}\n`,
    ),
  );
}

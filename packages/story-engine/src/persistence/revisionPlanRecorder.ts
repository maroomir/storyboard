import { type StoryUri } from '../paths/storyUri';
import type { IFileSystem } from '../ports/fileSystem';
import { type StoryboardProjectPaths } from '../paths/projectPaths';
import {
  createEmptyRevisionPlan,
  readRevisionPlanFile,
  type RevisionPlan,
  type RevisionPlanEntry,
  upsertRevisionEntry,
  writeRevisionPlanFile,
} from '../domain/files/revisionPlan';

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

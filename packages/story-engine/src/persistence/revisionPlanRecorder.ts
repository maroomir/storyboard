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

export class RevisionPlanRecorder {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async recordEntry(paths: StoryboardProjectPaths, entry: RevisionPlanEntry): Promise<void> {
    const current: RevisionPlan = await this.readPlanOrEmpty(paths.outlineRevisionPlan);
    const next: RevisionPlan = upsertRevisionEntry(current, entry);

    await this.fileSystem.createDirectory(paths.outlineDirectory);
    await writeRevisionPlanFile(paths.outlineRevisionPlan, this.fileSystem, next);
  }

  public async recordRounds(
    paths: StoryboardProjectPaths,
    sceneStem: string,
    rounds: readonly ReviseRound[],
  ): Promise<void> {
    await this.fileSystem.createDirectory(paths.revisionRoundsDirectory);
    await this.fileSystem.writeFile(
      joinStoryPath(paths.revisionRoundsDirectory, `${sceneStem}.json`),
      new TextEncoder().encode(
        `${JSON.stringify({ sceneStem, checkedAt: new Date().toISOString(), rounds }, null, 2)}\n`,
      ),
    );
  }

  private async readPlanOrEmpty(uri: StoryUri): Promise<RevisionPlan> {
    if (!(await this.fileSystem.exists(uri))) {
      return createEmptyRevisionPlan();
    }

    try {
      return await readRevisionPlanFile(uri, this.fileSystem);
    } catch {
      return createEmptyRevisionPlan();
    }
  }
}

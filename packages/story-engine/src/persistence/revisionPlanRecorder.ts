import {
  createEmptyRevisionPlan,
  joinStoryPath,
  upsertRevisionEntry,
  type RevisionPlan,
  type RevisionPlanEntry,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { ReviseRound } from '#engine/pipeline/reviseLoop';
import {
  RevisionPlanStore,
  type StoredRevisionPlan,
} from '#engine/persistence/cache/revisionPlanStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';

export interface RevisionPlanRecorderDependencies {
  readonly fileSystem: IFileSystem;
  readonly caches: WorkspaceCaches;
}

export class RevisionPlanRecorder {
  public constructor(private readonly dependencies: RevisionPlanRecorderDependencies) {}

  public async recordEntry(workspaceRoot: StoryUri, entry: RevisionPlanEntry): Promise<void> {
    const store: RevisionPlanStore = await this.openStore(workspaceRoot);
    const current: RevisionPlan = store.findLatest()?.plan ?? createEmptyRevisionPlan();

    store.saveLatest(upsertRevisionEntry(current, entry));
  }

  public async readLatest(workspaceRoot: StoryUri): Promise<StoredRevisionPlan | undefined> {
    return (await this.openStore(workspaceRoot)).findLatest();
  }

  public async replaceLatest(workspaceRoot: StoryUri, plan: RevisionPlan): Promise<void> {
    (await this.openStore(workspaceRoot)).saveLatest(plan);
  }

  public async recordRounds(
    paths: StoryboardProjectPaths,
    sceneStem: string,
    rounds: readonly ReviseRound[],
  ): Promise<void> {
    await this.dependencies.fileSystem.createDirectory(paths.revisionRoundsDirectory);
    await this.dependencies.fileSystem.writeFile(
      joinStoryPath(paths.revisionRoundsDirectory, `${sceneStem}.json`),
      new TextEncoder().encode(
        `${JSON.stringify({ sceneStem, checkedAt: new Date().toISOString(), rounds }, null, 2)}\n`,
      ),
    );
  }

  private async openStore(workspaceRoot: StoryUri): Promise<RevisionPlanStore> {
    return new RevisionPlanStore(await this.dependencies.caches.open(workspaceRoot));
  }
}

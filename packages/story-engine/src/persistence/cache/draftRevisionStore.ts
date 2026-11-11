import {
  archiveExistingDraft,
  draftRevisionRelativeDirectory,
  joinStoryPath,
  parseDraftHistoryRevision,
  sceneCacheRelativeDirectory,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';

export const keptDraftRevisionCount: number = 10;

export interface DraftRevisionStoreDependencies {
  readonly fileSystem: IFileSystem;
  readonly workspaceRoot: StoryUri;
  readonly now?: () => Date;
}

interface NumberedRevision {
  readonly fileName: string;
  readonly revision: number;
}

function listNumberedRevisions(fileNames: readonly string[]): readonly NumberedRevision[] {
  return fileNames
    .flatMap((fileName): NumberedRevision[] => {
      const revision: number | undefined = parseDraftHistoryRevision(fileName);
      return revision === undefined ? [] : [{ fileName, revision }];
    })
    .sort((left, right) => left.revision - right.revision);
}

export class DraftRevisionStore {
  public constructor(private readonly dependencies: DraftRevisionStoreDependencies) {}

  public async keepBeforeOverwrite(
    sceneId: string,
    draftRelativePath: string,
  ): Promise<string | undefined> {
    const historyDirectory: StoryUri = this.revisionDirectoryOf(sceneId);
    const keptFileName: string | undefined = await archiveExistingDraft({
      draftUri: this.uriOf(draftRelativePath),
      historyDirectory,
      resolveArchiveUri: (fileName: string): StoryUri => joinStoryPath(historyDirectory, fileName),
      fileSystem: this.dependencies.fileSystem,
      now: this.dependencies.now?.(),
    });
    if (keptFileName !== undefined) {
      await this.pruneOldRevisions(historyDirectory);
    }

    return keptFileName;
  }

  public async list(sceneId: string): Promise<readonly string[]> {
    const historyDirectory: StoryUri = this.revisionDirectoryOf(sceneId);
    if (!(await this.dependencies.fileSystem.exists(historyDirectory))) {
      return [];
    }

    return listNumberedRevisions(
      await this.dependencies.fileSystem.listFileNames(historyDirectory),
    ).map((entry) => entry.fileName);
  }

  public async removeAll(sceneId: string): Promise<void> {
    await this.dependencies.fileSystem.delete(this.revisionDirectoryOf(sceneId));
  }

  public sceneCacheDirectoryOf(sceneId: string): StoryUri {
    return this.uriOf(sceneCacheRelativeDirectory(sceneId));
  }

  public async clearSceneCache(sceneId: string): Promise<void> {
    await this.dependencies.fileSystem.delete(this.sceneCacheDirectoryOf(sceneId));
  }

  private async pruneOldRevisions(historyDirectory: StoryUri): Promise<void> {
    const revisions: readonly NumberedRevision[] = listNumberedRevisions(
      await this.dependencies.fileSystem.listFileNames(historyDirectory),
    );
    const overflow: readonly NumberedRevision[] = revisions.slice(
      0,
      Math.max(0, revisions.length - keptDraftRevisionCount),
    );
    for (const entry of overflow) {
      await this.dependencies.fileSystem.delete(joinStoryPath(historyDirectory, entry.fileName));
    }
  }

  private revisionDirectoryOf(sceneId: string): StoryUri {
    return this.uriOf(draftRevisionRelativeDirectory(sceneId));
  }

  private uriOf(relativePath: string): StoryUri {
    return joinStoryPath(this.dependencies.workspaceRoot, ...relativePath.split('/'));
  }
}

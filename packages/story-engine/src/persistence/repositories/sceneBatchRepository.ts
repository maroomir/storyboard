import {
  hasStoryboardProjectAt,
  joinStoryPath,
  type StoryUri,
  parseSceneFileName,
  getStoryboardProjectPaths,
  isHiddenSceneFileName,
  type SceneFileNameParts,
} from '@storyboard/story-model';
import type { IWorkspaceLocator } from '#engine/ports/workspaceLocator';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type {
  BatchSceneList,
  ISceneBatchRepository,
} from '#engine/application/drafts/draftRepositories';

interface NumberedSceneCardFile {
  name: string;
  parts: SceneFileNameParts;
}

export class SceneBatchRepository implements ISceneBatchRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspaceLocator: IWorkspaceLocator,
  ) {}

  public async listStoryboardScenes(): Promise<BatchSceneList> {
    const scenes: StoryUri[] = [];
    let projectCount: number = 0;
    for (const folder of this.workspaceLocator.folders()) {
      if (!(await hasStoryboardProjectAt(folder.uri, (uri) => this.fileSystem.exists(uri))))
        continue;
      projectCount += 1;
      scenes.push(
        ...(await this.listOrdered(getStoryboardProjectPaths(folder.uri).sceneDirectory)),
      );
    }
    return { projectCount, scenes };
  }

  private async listOrdered(sceneDirectory: StoryUri): Promise<StoryUri[]> {
    const entries: FileSystemDirectoryEntry[] = await this.fileSystem.readDirectory(sceneDirectory);
    const items: NumberedSceneCardFile[] = entries
      .filter(
        ([name, type]) =>
          type.type === 'file' && name.endsWith('.card') && !isHiddenSceneFileName(name),
      )
      .map(([name]) => ({ name, parts: parseSceneFileName(name) }))
      .filter((item): item is NumberedSceneCardFile => item.parts !== undefined)
      .sort(
        (left, right) =>
          left.parts.order - right.parts.order || left.name.localeCompare(right.name),
      );
    return items.map(({ name }) => joinStoryPath(sceneDirectory, name));
  }
}

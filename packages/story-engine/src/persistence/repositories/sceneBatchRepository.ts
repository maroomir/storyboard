import { hasStoryboardProjectAt } from '../../paths/projectDetection';
import type { WorkspaceLocator } from '../../ports/workspaceLocator';
import { joinStoryPath, type StoryUri } from '../../paths/storyUri';
import type { IFileSystem } from '../../ports/fileSystem';
import type {
  BatchSceneList,
  ISceneBatchRepository,
} from '../../application/drafts/generateAllDraftsUseCase';
import { getStoryboardProjectPaths, isHiddenSceneFileName } from '../../paths/projectPaths';
import { parseSceneFileName } from '@storyboard/story-format';

export class SceneBatchRepository implements ISceneBatchRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspaceLocator: WorkspaceLocator,
  ) {}

  public async listStoryboardScenes(): Promise<BatchSceneList> {
    const scenes: StoryUri[] = [];
    let projectCount = 0;
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
    const entries = await this.fileSystem.readDirectory(sceneDirectory);
    const items = entries
      .filter(
        ([name, type]) =>
          type.type === 'file' && name.endsWith('.card') && !isHiddenSceneFileName(name),
      )
      .map(([name]) => ({ name, parts: parseSceneFileName(name) }))
      .filter(
        (
          item,
        ): item is { name: string; parts: NonNullable<ReturnType<typeof parseSceneFileName>> } =>
          item.parts !== undefined,
      )
      .sort(
        (left, right) =>
          left.parts.order - right.parts.order || left.name.localeCompare(right.name),
      );
    return items.map(({ name }) => joinStoryPath(sceneDirectory, name));
  }
}

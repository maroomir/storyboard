import { hasStoryboardProjectAt, type StoryUri } from '@storyboard/story-model';
import type { IWorkspaceLocator } from '#engine/ports/workspaceLocator';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';
import type {
  BatchSceneList,
  ISceneBatchRepository,
} from '#engine/application/drafts/draftRepositories';

export class SceneBatchRepository implements ISceneBatchRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly workspaceLocator: IWorkspaceLocator,
    private readonly scenes: WorkspaceScenes,
  ) {}

  public async listStoryboardScenes(): Promise<BatchSceneList> {
    const scenes: StoryUri[] = [];
    let projectCount: number = 0;
    for (const folder of this.workspaceLocator.folders()) {
      if (!(await hasStoryboardProjectAt(folder.uri, (uri) => this.fileSystem.exists(uri))))
        continue;
      projectCount += 1;
      scenes.push(
        ...(await this.scenes.loadRoster(folder.uri)).scenes.map((scene) =>
          this.scenes.sceneUri(folder.uri, scene.stem),
        ),
      );
    }
    return { projectCount, scenes };
  }

}

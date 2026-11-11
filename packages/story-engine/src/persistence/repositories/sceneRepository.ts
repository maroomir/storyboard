import type { StoryUri, SceneBeat, SceneFile } from '@storyboard/story-model';
import type { ISceneRepository } from '#engine/application/drafts/draftRepositories';
import type { WorkspaceScenes } from '#engine/persistence/bundles/workspaceScenes';

export class SceneRepository implements ISceneRepository {
  public constructor(private readonly scenes: WorkspaceScenes) {}

  public async read(uri: StoryUri): Promise<SceneFile> {
    return await this.scenes.readByUri(uri);
  }

  public async writeBeats(uri: StoryUri, beats: readonly SceneBeat[]): Promise<void> {
    await this.scenes.writeBeatsByUri(uri, beats);
  }
}

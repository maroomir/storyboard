import {
  draftPath,
  draftRevisionRelativeDirectory,
  joinStoryPath,
  sceneCacheRelativeDirectory,
  type StoryUri,
} from '@storyboard/story-model';

import type { HostAdapters } from '#engine/application/engineServices';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import {
  SceneRenumberer,
  type SceneStemChange,
} from '#engine/persistence/bundles/sceneRenumberer';
import type { SceneRosterEntry } from '#engine/persistence/bundles/workspaceScenes';

export interface RemoveSceneRequest {
  readonly workspaceRoot: StoryUri;
  readonly scene: string;
}

export type RemoveSceneResult =
  | {
      readonly ok: true;
      readonly kind: 'removed';
      readonly stem: string;
      readonly renamed: readonly SceneStemChange[];
    }
  | { readonly ok: false; readonly kind: 'missing'; readonly message: string }
  | UseCaseFailure;

export class RemoveSceneUseCase implements IUseCase<RemoveSceneRequest, RemoveSceneResult> {
  public constructor(private readonly host: HostAdapters) {}

  public async execute(request: RemoveSceneRequest): Promise<RemoveSceneResult> {
    return await runUseCase<RemoveSceneResult>(this.host.logger, 'Remove scene failed', () =>
      this.remove(request),
    );
  }

  private async remove(request: RemoveSceneRequest): Promise<RemoveSceneResult> {
    const root: StoryUri = request.workspaceRoot;
    const renumberer: SceneRenumberer = new SceneRenumberer(this.host);
    await renumberer.resume(root);

    const removing: SceneRosterEntry | undefined = await this.host.scenes.find(root, request.scene);
    if (removing === undefined) {
      return { ok: false, kind: 'missing', message: `씬이 없습니다: ${request.scene}` };
    }

    await renumberer.withdraw(root, removing.content.header.id);
    await this.deleteSceneFiles(root, removing);

    return {
      ok: true,
      kind: 'removed',
      stem: removing.file.stem,
      renamed: await renumberer.renumber(root),
    };
  }

  private async deleteSceneFiles(root: StoryUri, removing: SceneRosterEntry): Promise<void> {
    const sceneId: string = removing.content.header.id;

    await this.host.scenes.removeBundle(root, removing.path);
    for (const uri of [
      draftPath(root, removing.file.stem),
      joinStoryPath(root, ...draftRevisionRelativeDirectory(sceneId).split('/')),
      joinStoryPath(root, ...sceneCacheRelativeDirectory(sceneId).split('/')),
    ]) {
      if (await this.host.fileSystem.exists(uri)) {
        await this.host.fileSystem.delete(uri);
      }
    }
  }
}

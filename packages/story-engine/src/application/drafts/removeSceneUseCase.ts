import {
  draftPath,
  draftRevisionRelativeDirectory,
  joinStoryPath,
  retargetRemovedSceneWindows,
  sceneCacheRelativeDirectory,
  type RemovedSceneNeighbours,
  type Statement,
  type StoryUri,
} from '@storyboard/story-model';

import type { HostAdapters } from '#engine/application/engineServices';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import {
  SceneRenumberer,
  type SceneStemChange,
} from '#engine/persistence/bundles/sceneRenumberer';
import type { SceneRosterEntry } from '#engine/persistence/bundles/workspaceScenes';
import type { CardRoster } from '#engine/persistence/bundles/workspaceCards';

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

    const removedSceneId: string = removing.content.header.id;
    const neighbours: RemovedSceneNeighbours = await this.findNeighbours(root, removedSceneId);
    await renumberer.withdraw(root, removedSceneId);
    await this.deleteSceneFiles(root, removing);
    await this.retargetCardSceneWindows(root, removedSceneId, neighbours);

    return {
      ok: true,
      kind: 'removed',
      stem: removing.file.stem,
      renamed: await renumberer.renumber(root),
    };
  }

  private async findNeighbours(root: StoryUri, sceneId: string): Promise<RemovedSceneNeighbours> {
    const { entries } = await this.host.scenes.loadRoster(root);
    const index: number = entries.findIndex((entry) => entry.content.header.id === sceneId);
    const previous: string | undefined = entries[index - 1]?.content.header.id;
    const next: string | undefined = entries[index + 1]?.content.header.id;

    return {
      ...(previous === undefined ? {} : { previous }),
      ...(next === undefined ? {} : { next }),
    };
  }

  private async retargetCardSceneWindows(
    root: StoryUri,
    removedSceneId: string,
    neighbours: RemovedSceneNeighbours,
  ): Promise<void> {
    const roster: CardRoster = await this.host.cards.loadRoster(root);

    for (const bundle of roster.bundles) {
      const statements: readonly Statement[] | undefined = retargetRemovedSceneWindows(
        bundle.statements,
        removedSceneId,
        neighbours,
      );
      if (statements !== undefined) {
        await this.host.cards.rewriteBundle(root, bundle, { header: bundle.header, statements });
      }
    }
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

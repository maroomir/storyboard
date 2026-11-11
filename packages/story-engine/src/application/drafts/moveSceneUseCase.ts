import type { StoryUri } from '@storyboard/story-model';

import type { HostAdapters } from '#engine/application/engineServices';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import {
  SceneRenumberer,
  type SceneStemChange,
} from '#engine/persistence/bundles/sceneRenumberer';
import type { SceneRosterEntry } from '#engine/persistence/bundles/workspaceScenes';

export interface MoveSceneRequest {
  readonly workspaceRoot: StoryUri;
  readonly scene: string;
  readonly after?: string;
}

export type MoveSceneResult =
  | {
      readonly ok: true;
      readonly kind: 'moved';
      readonly stem: string;
      readonly renamed: readonly SceneStemChange[];
    }
  | { readonly ok: false; readonly kind: 'missing' | 'same-scene'; readonly message: string }
  | UseCaseFailure;

export class MoveSceneUseCase implements IUseCase<MoveSceneRequest, MoveSceneResult> {
  public constructor(private readonly host: HostAdapters) {}

  public async execute(request: MoveSceneRequest): Promise<MoveSceneResult> {
    return await runUseCase<MoveSceneResult>(this.host.logger, 'Move scene failed', () =>
      this.move(request),
    );
  }

  private async move(request: MoveSceneRequest): Promise<MoveSceneResult> {
    const renumberer: SceneRenumberer = new SceneRenumberer(this.host);
    await renumberer.resume(request.workspaceRoot);

    const moving: SceneRosterEntry | undefined = await this.host.scenes.find(
      request.workspaceRoot,
      request.scene,
    );
    const after: SceneRosterEntry | undefined =
      request.after === undefined
        ? undefined
        : await this.host.scenes.find(request.workspaceRoot, request.after);
    const missingReference: string | undefined =
      moving === undefined ? request.scene : request.after !== undefined && after === undefined ? request.after : undefined;
    if (moving === undefined || missingReference !== undefined) {
      return { ok: false, kind: 'missing', message: `씬이 없습니다: ${missingReference ?? request.scene}` };
    }

    const sceneId: string = moving.content.header.id;
    const afterSceneId: string | undefined = after?.content.header.id;
    if (afterSceneId === sceneId) {
      return { ok: false, kind: 'same-scene', message: '씬을 자기 뒤로 옮길 수 없습니다.' };
    }

    const renamed: readonly SceneStemChange[] = await renumberer.placeAfter(
      request.workspaceRoot,
      sceneId,
      afterSceneId,
    );
    const stem: string =
      renamed.find((change) => change.sceneId === sceneId)?.toStem ?? moving.file.stem;

    return { ok: true, kind: 'moved', stem, renamed };
  }
}

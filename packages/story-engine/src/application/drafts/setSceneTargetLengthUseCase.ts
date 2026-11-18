import type { StoryUri } from '@storyboard/story-model';

import type { HostAdapters } from '#engine/application/engineServices';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import type { SceneRosterEntry } from '#engine/persistence/bundles/workspaceScenes';

export type SceneTargetLengthScenes = readonly string[] | 'all';

export interface SetSceneTargetLengthRequest {
  readonly workspaceRoot: StoryUri;
  readonly scenes: SceneTargetLengthScenes;
  readonly targetWordCount: number | undefined;
}

export type SetSceneTargetLengthResult =
  | {
      readonly ok: true;
      readonly kind: 'set' | 'unset';
      readonly stems: readonly string[];
      readonly targetWordCount: number | undefined;
    }
  | { readonly ok: false; readonly kind: 'missing'; readonly message: string }
  | UseCaseFailure;

export class SetSceneTargetLengthUseCase
  implements IUseCase<SetSceneTargetLengthRequest, SetSceneTargetLengthResult>
{
  public constructor(private readonly host: HostAdapters) {}

  public async execute(request: SetSceneTargetLengthRequest): Promise<SetSceneTargetLengthResult> {
    return await runUseCase<SetSceneTargetLengthResult>(
      this.host.logger,
      'Set scene target length failed',
      () => this.write(request),
    );
  }

  private async write(request: SetSceneTargetLengthRequest): Promise<SetSceneTargetLengthResult> {
    const stems: string[] | { readonly missing: string } = await this.resolveStems(request);
    if (!Array.isArray(stems)) {
      return { ok: false, kind: 'missing', message: `씬이 없습니다: ${stems.missing}` };
    }

    for (const stem of stems) {
      await this.host.scenes.writeTargetWordCount(request.workspaceRoot, stem, request.targetWordCount);
    }

    return {
      ok: true,
      kind: request.targetWordCount === undefined ? 'unset' : 'set',
      stems,
      targetWordCount: request.targetWordCount,
    };
  }

  private async resolveStems(
    request: SetSceneTargetLengthRequest,
  ): Promise<string[] | { readonly missing: string }> {
    if (request.scenes === 'all') {
      return (await this.host.scenes.loadRoster(request.workspaceRoot)).entries.map((entry) => entry.file.stem);
    }

    const stems: string[] = [];
    for (const reference of request.scenes) {
      const found: SceneRosterEntry | undefined = await this.host.scenes.find(request.workspaceRoot, reference);
      if (found === undefined) {
        return { missing: reference };
      }
      stems.push(found.file.stem);
    }

    return stems;
  }
}

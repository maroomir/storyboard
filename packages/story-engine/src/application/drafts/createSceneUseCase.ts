import type { HostAdapters } from '#engine/application/engineServices';
import {
  formatNumberedSceneStem,
  type StatementSource,
  type StoryUri,
} from '@storyboard/story-model';

import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import type { SceneRoster, WrittenScene } from '#engine/persistence/bundles/workspaceScenes';

const authorSource: StatementSource = { origin: 'author' };
export interface CreateSceneRequest {
  readonly workspaceRoot: StoryUri;
  readonly slug?: string;
}

export type CreateSceneResult =
  | { readonly ok: true; readonly kind: 'created'; readonly stem: string; readonly uri: StoryUri }
  | { readonly ok: false; readonly kind: 'exists'; readonly message: string }
  | UseCaseFailure;

export class CreateSceneUseCase implements IUseCase<CreateSceneRequest, CreateSceneResult> {
  public constructor(private readonly host: HostAdapters) {}

  public async execute(request: CreateSceneRequest): Promise<CreateSceneResult> {
    return await runUseCase<CreateSceneResult>(this.host.logger, 'Create scene failed', () =>
      this.create(request),
    );
  }

  private async create(request: CreateSceneRequest): Promise<CreateSceneResult> {
    const { scenes } = this.host;
    const roster: SceneRoster = await scenes.loadRoster(request.workspaceRoot);
    const number: number = roster.structure.scenes.length + 1;
    const slug: string = request.slug ?? `scene-${number}`;

    if (roster.scenes.some((scene) => scene.slug === slug)) {
      return { ok: false, kind: 'exists', message: `이미 있습니다: ${slug}` };
    }

    const written: WrittenScene = await scenes.writeCard(
      request.workspaceRoot,
      { type: 'scene', id: formatNumberedSceneStem(number, slug), title: slug },
      { source: authorSource, slug },
    );

    return { ok: true, kind: 'created', stem: written.stem, uri: written.uri };
  }
}

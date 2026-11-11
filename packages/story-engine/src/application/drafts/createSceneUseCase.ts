import type { HostAdapters } from '#engine/application/engineServices';
import {
  formatNumberedSceneStem,
  type StatementSource,
  type StoryUri,
} from '@storyboard/story-model';

import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import {
  SceneRenumberer,
  type SceneStemChange,
} from '#engine/persistence/bundles/sceneRenumberer';
import type {
  SceneRoster,
  SceneRosterEntry,
  WrittenScene,
} from '#engine/persistence/bundles/workspaceScenes';

const authorSource: StatementSource = { origin: 'author' };
export interface CreateSceneRequest {
  readonly workspaceRoot: StoryUri;
  readonly slug?: string;
  readonly after?: string;
}

export type CreateSceneResult =
  | { readonly ok: true; readonly kind: 'created'; readonly stem: string; readonly uri: StoryUri }
  | { readonly ok: false; readonly kind: 'exists' | 'missing'; readonly message: string }
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
    const renumberer: SceneRenumberer = new SceneRenumberer(this.host);
    await renumberer.resume(request.workspaceRoot);

    const roster: SceneRoster = await scenes.loadRoster(request.workspaceRoot);
    const number: number = roster.structure.scenes.length + 1;
    const slug: string = request.slug ?? `scene-${number}`;
    const after: SceneRosterEntry | undefined =
      request.after === undefined ? undefined : await scenes.find(request.workspaceRoot, request.after);

    if (roster.scenes.some((scene) => scene.slug === slug)) {
      return { ok: false, kind: 'exists', message: `이미 있습니다: ${slug}` };
    }
    if (request.after !== undefined && after === undefined) {
      return { ok: false, kind: 'missing', message: `씬이 없습니다: ${request.after}` };
    }

    const written: WrittenScene = await scenes.writeCard(
      request.workspaceRoot,
      { type: 'scene', id: formatNumberedSceneStem(number, slug), title: slug },
      { source: authorSource, slug },
    );
    const stem: string =
      after === undefined ? written.stem : await this.placeAfter(request.workspaceRoot, renumberer, written.stem, after);

    return { ok: true, kind: 'created', stem, uri: scenes.sceneUri(request.workspaceRoot, stem) };
  }

  private async placeAfter(
    workspaceRoot: StoryUri,
    renumberer: SceneRenumberer,
    stem: string,
    after: SceneRosterEntry,
  ): Promise<string> {
    const created: SceneRosterEntry | undefined = await this.host.scenes.find(workspaceRoot, stem);
    if (created === undefined) {
      return stem;
    }

    const renamed: readonly SceneStemChange[] = await renumberer.placeAfter(
      workspaceRoot,
      created.content.header.id,
      after.content.header.id,
    );
    return renamed.find((change) => change.sceneId === created.content.header.id)?.toStem ?? stem;
  }
}

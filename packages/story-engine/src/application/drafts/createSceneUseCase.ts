import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
import type { HostAdapters } from '#engine/application/engineServices';
import {
  getStoryboardProjectPaths,
  parseSceneFileName,
  resolveScenePrefixDigitCount,
  sceneFilePath,
  serializeSceneCard,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import { readProjectJson } from '#engine/persistence/projectJson';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';

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
    const { fileSystem } = this.host;
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(request.workspaceRoot);
    const project: StoryboardProject = await readProjectJson(fileSystem, paths.projectJson);
    const existing: readonly string[] = await new WorkspaceFiles(fileSystem).listNames(
      paths.sceneDirectory,
    );

    const highestOrder: number = existing
      .map((fileName) => parseSceneFileName(fileName)?.order)
      .filter((order): order is number => order !== undefined)
      .reduce((highest, order) => Math.max(highest, order), 0);
    const order: number = highestOrder + 1;
    const digitCount: number = resolveScenePrefixDigitCount(
      project.editor.scenePrefixDigits,
      undefined,
    );
    const prefix: string = String(order).padStart(digitCount, '0');
    const slug: string = request.slug ?? `scene-${order}`;
    const stem: string = `${prefix}-${slug}`;
    const uri: StoryUri = sceneFilePath(request.workspaceRoot, prefix, slug);

    if (await fileSystem.exists(uri)) {
      return { ok: false, kind: 'exists', message: `이미 있습니다: ${stem}.card` };
    }

    await fileSystem.createDirectory(paths.sceneDirectory);
    await fileSystem.writeFile(
      uri,
      new TextEncoder().encode(serializeSceneCard({ type: 'scene', id: stem })),
    );

    return { ok: true, kind: 'created', stem, uri };
  }
}

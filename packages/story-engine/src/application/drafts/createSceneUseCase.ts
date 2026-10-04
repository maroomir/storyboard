import {
  getStoryboardProjectPaths,
  parseSceneFileName,
  resolveScenePrefixDigitCount,
  sceneFilePath,
  serializeSceneCard,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { listDirectoryFileNames } from '#engine/persistence/directoryFiles';
import { readProjectJson } from '#engine/persistence/projectJson';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';

export interface CreateSceneRequest {
  readonly workspaceRoot: StoryUri;
  // The file-name part after the number. A scene's identity is its number, so a name that yields
  // no slug still gets a card: it is filed as `scene-<number>`.
  readonly slug?: string;
}

export type CreateSceneResult =
  | { readonly ok: true; readonly kind: 'created'; readonly stem: string; readonly uri: StoryUri }
  | { readonly ok: false; readonly kind: 'exists'; readonly message: string }
  | UseCaseFailure;

export interface CreateSceneUseCaseDependencies {
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
}

// A new, empty scene card after the highest number in use — the workspace's own numbering, so the
// author never has to pick one.
export class CreateSceneUseCase implements IUseCase<CreateSceneRequest, CreateSceneResult> {
  public constructor(private readonly deps: CreateSceneUseCaseDependencies) {}

  public async execute(request: CreateSceneRequest): Promise<CreateSceneResult> {
    return await runUseCase<CreateSceneResult>(this.deps.logger, 'Create scene failed', () =>
      this.create(request),
    );
  }

  private async create(request: CreateSceneRequest): Promise<CreateSceneResult> {
    const { fileSystem } = this.deps;
    const paths = getStoryboardProjectPaths(request.workspaceRoot);
    const project = await readProjectJson(fileSystem, paths.projectJson);
    const existing = await listDirectoryFileNames(fileSystem, paths.sceneDirectory);

    const highestOrder = existing
      .map((fileName) => parseSceneFileName(fileName)?.order)
      .filter((order): order is number => order !== undefined)
      .reduce((highest, order) => Math.max(highest, order), 0);
    const order = highestOrder + 1;
    const digitCount = resolveScenePrefixDigitCount(project.editor.scenePrefixDigits, undefined);
    const prefix = String(order).padStart(digitCount, '0');
    const slug = request.slug ?? `scene-${order}`;
    const stem = `${prefix}-${slug}`;
    const uri = sceneFilePath(request.workspaceRoot, prefix, slug);

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

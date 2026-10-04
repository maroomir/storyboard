import {
  buildSceneSeeds,
  getStoryboardProjectPaths,
  readChapterPlanFile,
  resolveScenePrefixDigitCount,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { listDirectoryFileNames } from '#engine/persistence/directoryFiles';
import { readProjectJson } from '#engine/persistence/projectJson';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import type { ISceneSeedRepository } from './novelPipelinePorts';

export interface SeedScenesRequest {
  readonly workspaceRoot: StoryUri;
  // Seeds replace the scene cards of the same name. Without this, a workspace that already has
  // scene files is refused rather than overwritten.
  readonly overwrite: boolean;
}

export type SeedScenesResult =
  | { readonly ok: true; readonly kind: 'seeded'; readonly fileNames: readonly string[] }
  | { readonly ok: true; readonly kind: 'empty_plan' }
  | { readonly ok: false; readonly kind: 'missing_outline' }
  | { readonly ok: false; readonly kind: 'existing_scenes'; readonly existingCount: number }
  | UseCaseFailure;

export interface SeedScenesUseCaseDependencies {
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
  readonly sceneSeedRepository: ISceneSeedRepository;
}

// Scene cards from the chapter plan. No model is involved: `buildSceneSeeds` is deterministic.
export class SeedScenesUseCase implements IUseCase<SeedScenesRequest, SeedScenesResult> {
  public constructor(private readonly deps: SeedScenesUseCaseDependencies) {}

  public async execute(request: SeedScenesRequest): Promise<SeedScenesResult> {
    return await runUseCase<SeedScenesResult>(this.deps.logger, 'Seed scenes failed', () =>
      this.seed(request),
    );
  }

  private async seed(request: SeedScenesRequest): Promise<SeedScenesResult> {
    const { fileSystem, sceneSeedRepository } = this.deps;
    const paths = getStoryboardProjectPaths(request.workspaceRoot);

    if (!(await fileSystem.exists(paths.outlineChapters))) {
      return { ok: false, kind: 'missing_outline' };
    }

    const project = await readProjectJson(fileSystem, paths.projectJson);
    const plan = await readChapterPlanFile(paths.outlineChapters, fileSystem);
    const seeds = buildSceneSeeds(
      plan,
      resolveScenePrefixDigitCount(project.editor.scenePrefixDigits, undefined),
    );

    if (seeds.length === 0) {
      return { ok: true, kind: 'empty_plan' };
    }

    const existing = await listDirectoryFileNames(fileSystem, paths.sceneDirectory);

    if (existing.length > 0 && !request.overwrite) {
      return { ok: false, kind: 'existing_scenes', existingCount: existing.length };
    }

    await sceneSeedRepository.saveSeeds(request.workspaceRoot, seeds);

    return { ok: true, kind: 'seeded', fileNames: seeds.map((seed) => seed.fileName) };
  }
}

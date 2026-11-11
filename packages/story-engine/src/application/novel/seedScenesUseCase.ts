import type { HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import {
  buildSceneSeeds,
  getStoryboardProjectPaths,
  readChapterPlanFile,
  type ChapterPlan,
  type GeneratedSceneSeed,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';

export interface SeedScenesRequest {
  readonly workspaceRoot: StoryUri;
  readonly overwrite: boolean;
}

export type SeedScenesResult =
  | { readonly ok: true; readonly kind: 'seeded'; readonly fileNames: readonly string[] }
  | { readonly ok: true; readonly kind: 'empty_plan' }
  | { readonly ok: false; readonly kind: 'missing_outline' }
  | { readonly ok: false; readonly kind: 'existing_scenes'; readonly existingCount: number }
  | UseCaseFailure;

export class SeedScenesUseCase implements IUseCase<SeedScenesRequest, SeedScenesResult> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: SeedScenesRequest): Promise<SeedScenesResult> {
    return await runUseCase<SeedScenesResult>(this.host.logger, 'Seed scenes failed', () =>
      this.seed(request),
    );
  }

  private async seed(request: SeedScenesRequest): Promise<SeedScenesResult> {
    const { fileSystem } = this.host;
    const { sceneSeeds: sceneSeedRepository } = this.repositories;
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(request.workspaceRoot);

    if (!(await fileSystem.exists(paths.outlineChapters))) {
      return { ok: false, kind: 'missing_outline' };
    }

    const plan: ChapterPlan = await readChapterPlanFile(paths.outlineChapters, fileSystem);
    const seeds: GeneratedSceneSeed[] = buildSceneSeeds(plan);

    if (seeds.length === 0) {
      return { ok: true, kind: 'empty_plan' };
    }

    const existingCount: number = (
      await sceneSeedRepository.listSceneStemsByOrder(request.workspaceRoot)
    ).size;

    if (existingCount > 0 && !request.overwrite) {
      return { ok: false, kind: 'existing_scenes', existingCount };
    }

    await sceneSeedRepository.saveSeeds(request.workspaceRoot, seeds);

    return { ok: true, kind: 'seeded', fileNames: seeds.map((seed) => seed.fileName) };
  }
}

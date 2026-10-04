import {
  getStoryboardProjectPaths,
  type NarratorCard,
  type ProjectSetting,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { readProjectJson, writeProjectJson } from '#engine/persistence/projectJson';
import { writeNarratorCardsIfMissing } from '#engine/persistence/projectInitializer';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';

export interface UpdateProjectContractRequest {
  readonly workspaceRoot: StoryUri;
  // Only the keys given change; the rest of the contract keeps its value.
  readonly setting: Partial<ProjectSetting>;
  // Narrator cards a composition preset asked for. One that already exists is left as written.
  readonly narratorCards?: readonly NarratorCard[];
}

export type UpdateProjectContractResult =
  | {
      readonly ok: true;
      readonly kind: 'updated';
      readonly setting: ProjectSetting;
      readonly createdNarrators: readonly string[];
    }
  | UseCaseFailure;

export interface UpdateProjectContractUseCaseDependencies {
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
}

// 계약은 한 번에 다 채워지지 않는다. 주지 않은 키는 그대로 두고 준 키만 덮어쓴다.
export function mergeProjectSetting(
  current: ProjectSetting | undefined,
  patch: Partial<ProjectSetting>,
): ProjectSetting {
  return {
    tags: [],
    prohibitions: [],
    styleConstraints: [],
    qualityCriteria: [],
    ...(current ?? {}),
    ...patch,
  };
}

export class UpdateProjectContractUseCase
  implements IUseCase<UpdateProjectContractRequest, UpdateProjectContractResult>
{
  public constructor(private readonly deps: UpdateProjectContractUseCaseDependencies) {}

  public async execute(
    request: UpdateProjectContractRequest,
  ): Promise<UpdateProjectContractResult> {
    return await runUseCase<UpdateProjectContractResult>(
      this.deps.logger,
      'Update project contract failed',
      async () => {
        const { fileSystem } = this.deps;
        const paths = getStoryboardProjectPaths(request.workspaceRoot);
        const project = await readProjectJson(fileSystem, paths.projectJson);
        const setting = mergeProjectSetting(project.setting, request.setting);

        await writeProjectJson(fileSystem, paths.projectJson, { ...project, setting });
        const createdNarrators = await writeNarratorCardsIfMissing(
          fileSystem,
          paths,
          request.narratorCards ?? [],
        );

        return { ok: true, kind: 'updated', setting, createdNarrators };
      },
    );
  }
}

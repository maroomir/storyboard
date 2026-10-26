import type { HostAdapters } from '#engine/application/engineServices';
import {
  getStoryboardProjectPaths,
  type NarratorCard,
  type ProjectSetting,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import { readProjectJson, writeProjectJson } from '#engine/persistence/projectJson';
import { writeNarratorCardsIfMissing } from '#engine/persistence/projectInitializer';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';

export interface UpdateProjectContractRequest {
  readonly workspaceRoot: StoryUri;
  readonly setting: Partial<ProjectSetting>;
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

export class UpdateProjectContractUseCase implements IUseCase<
  UpdateProjectContractRequest,
  UpdateProjectContractResult
> {
  public constructor(private readonly host: HostAdapters) {}

  public async execute(
    request: UpdateProjectContractRequest,
  ): Promise<UpdateProjectContractResult> {
    return await runUseCase<UpdateProjectContractResult>(
      this.host.logger,
      'Update project contract failed',
      async () => {
        const { fileSystem } = this.host;
        const paths: StoryboardProjectPaths = getStoryboardProjectPaths(request.workspaceRoot);
        const project: StoryboardProject = await readProjectJson(fileSystem, paths.projectJson);
        const setting: ProjectSetting = mergeProjectSetting(project.setting, request.setting);

        await writeProjectJson(fileSystem, paths.projectJson, { ...project, setting });
        const createdNarrators: string[] = await writeNarratorCardsIfMissing(
          fileSystem,
          paths,
          request.narratorCards ?? [],
        );

        return { ok: true, kind: 'updated', setting, createdNarrators };
      },
    );
  }
}

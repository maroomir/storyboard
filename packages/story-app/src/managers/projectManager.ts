import type {
  IFileSystem,
  UpdateProjectContractRequest,
  UpdateProjectContractResult,
  UpdateProjectContractUseCase,
} from '@storyboard/story-engine';
import { ProjectRepository } from '@storyboard/story-engine';
import {
  getStoryboardProjectPaths,
  type StoryboardProject,
  type StoryUri,
} from '@storyboard/story-model';

export interface ProjectManagerDependencies {
  readonly fileSystem: IFileSystem;
  readonly updateProjectContractUseCase: UpdateProjectContractUseCase;
}

export class ProjectManager {
  public constructor(private readonly deps: ProjectManagerDependencies) {}

  public read(workspaceRoot: StoryUri): Promise<StoryboardProject> {
    return new ProjectRepository(this.deps.fileSystem).read(
      getStoryboardProjectPaths(workspaceRoot).projectJson,
    );
  }

  public updateContract(
    request: UpdateProjectContractRequest,
  ): Promise<UpdateProjectContractResult> {
    return this.deps.updateProjectContractUseCase.execute(request);
  }
}

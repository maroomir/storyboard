import { posix } from 'node:path';

import {
  STORYBOARD_RELATIVE_PATHS,
  parseStoryStructure,
  projectThreadsOfStructure,
  serializeStoryStructure,
  structureWithProjectThreads,
  type ProjectSetting,
  type StoryStructure,
  type StoryUri,
  type StoryboardProject,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IProjectRepository } from '#engine/application/drafts/draftRepositories';
import { parseProjectJson, serializeProjectJson } from '#engine/persistence/projectJson';

const structureFileName: string = posix.basename(STORYBOARD_RELATIVE_PATHS.structure);

function structureUriBeside(projectJsonUri: StoryUri): StoryUri {
  return projectJsonUri.with({
    path: posix.join(posix.dirname(projectJsonUri.path), structureFileName),
  });
}

const emptySetting: ProjectSetting = {
  tags: [],
  prohibitions: [],
  styleConstraints: [],
  qualityCriteria: [],
};

function withThreads(
  project: StoryboardProject,
  structure: StoryStructure | undefined,
): StoryboardProject {
  const threads: ProjectSetting['threads'] = projectThreadsOfStructure(structure);
  if (threads === undefined) {
    return project;
  }

  return { ...project, setting: { ...(project.setting ?? emptySetting), threads } };
}

function withoutThreads(project: StoryboardProject): StoryboardProject {
  if (project.setting?.threads === undefined) {
    return project;
  }

  const { threads: _threadsLiveInTheStructure, ...setting } = project.setting;
  return { ...project, setting };
}

export class ProjectRepository implements IProjectRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: StoryUri): Promise<StoryboardProject> {
    const bytes: Uint8Array = await this.fileSystem.readFile(uri);
    const project: StoryboardProject = parseProjectJson(new TextDecoder().decode(bytes));

    return withThreads(project, await this.readStructure(uri));
  }

  public async write(uri: StoryUri, project: StoryboardProject): Promise<void> {
    const structure: StoryStructure = structureWithProjectThreads(
      await this.readStructure(uri),
      project.setting?.threads,
    );

    await this.fileSystem.writeFile(
      structureUriBeside(uri),
      new TextEncoder().encode(serializeStoryStructure(structure)),
    );
    await this.fileSystem.writeFile(
      uri,
      new TextEncoder().encode(serializeProjectJson(withoutThreads(project))),
    );
  }

  private async readStructure(projectJsonUri: StoryUri): Promise<StoryStructure | undefined> {
    const structureUri: StoryUri = structureUriBeside(projectJsonUri);
    if (!(await this.fileSystem.exists(structureUri))) {
      return undefined;
    }

    return parseStoryStructure(
      new TextDecoder().decode(await this.fileSystem.readFile(structureUri)),
      STORYBOARD_RELATIVE_PATHS.structure,
    );
  }
}

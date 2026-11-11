import {
  STORYBOARD_RELATIVE_PATHS,
  getStoryboardProjectPaths,
  parseStoryStructure,
  serializeStoryStructure,
  type StoryStructure,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';

export interface StructureRepositoryDependencies {
  readonly fileSystem: IFileSystem;
  readonly workspaceRoot: StoryUri;
}

export class StructureRepository {
  public constructor(private readonly dependencies: StructureRepositoryDependencies) {}

  public async read(): Promise<StoryStructure | undefined> {
    const uri: StoryUri = this.structureUri();
    if (!(await this.dependencies.fileSystem.exists(uri))) {
      return undefined;
    }

    return parseStoryStructure(
      new TextDecoder().decode(await this.dependencies.fileSystem.readFile(uri)),
      STORYBOARD_RELATIVE_PATHS.structure,
    );
  }

  public async write(structure: StoryStructure): Promise<void> {
    await this.dependencies.fileSystem.writeFile(
      this.structureUri(),
      new TextEncoder().encode(serializeStoryStructure(structure)),
    );
  }

  private structureUri(): StoryUri {
    return getStoryboardProjectPaths(this.dependencies.workspaceRoot).structure;
  }
}

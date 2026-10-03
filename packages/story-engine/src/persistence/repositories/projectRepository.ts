import type { StoryUri, StoryboardProject } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IProjectRepository } from '#engine/application/drafts/draftRepositories';
import { parseProjectJson } from '#engine/persistence/projectJson';

export class ProjectRepository implements IProjectRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: StoryUri): Promise<StoryboardProject> {
    const bytes = await this.fileSystem.readFile(uri);
    return parseProjectJson(new TextDecoder().decode(bytes));
  }
}

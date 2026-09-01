import type { StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IProjectRepository } from '#engine/ports/repositories';
import { parseProjectJson } from '#engine/persistence/projectJson';
import type { StoryboardProject } from '@storyboard/story-format';

export class ProjectRepository implements IProjectRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: StoryUri): Promise<StoryboardProject> {
    const bytes = await this.fileSystem.readFile(uri);
    return parseProjectJson(new TextDecoder().decode(bytes));
  }
}

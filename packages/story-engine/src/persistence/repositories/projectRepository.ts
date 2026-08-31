import type { IFileSystem } from '../../ports/fileSystem';
import type { IProjectRepository } from '../../ports/repositories';
import { parseProjectJson } from '../projectJson';
import type { StoryboardProject } from '@storyboard/story-format';

export class ProjectRepository implements IProjectRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async read(uri: unknown): Promise<StoryboardProject> {
    const bytes = await this.fileSystem.readFile(uri);
    return parseProjectJson(new TextDecoder().decode(bytes));
  }
}

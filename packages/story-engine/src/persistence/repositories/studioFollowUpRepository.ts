import {
  joinStoryPath,
  type StoryUri,
  addFollowUps,
  parseStudioFollowUps,
  removeFollowUp,
  resolveFollowUpsFor,
  selectFollowUpsFor,
  serializeStudioFollowUps,
  type StudioFollowUp,
  getStoryboardProjectPaths,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { StudioEntity } from '@storyboard/story-model';

export interface IStudioFollowUpRepository {
  list(workspaceRoot: StoryUri, target: StudioEntity): Promise<readonly StudioFollowUp[]>;
  add(workspaceRoot: StoryUri, added: readonly StudioFollowUp[]): Promise<void>;
  resolveFor(workspaceRoot: StoryUri, target: StudioEntity): Promise<void>;
  dismiss(workspaceRoot: StoryUri, id: string): Promise<void>;
}

export class StudioFollowUpRepository implements IStudioFollowUpRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async list(
    workspaceRoot: StoryUri,
    target: StudioEntity,
  ): Promise<readonly StudioFollowUp[]> {
    return selectFollowUpsFor(await this.readAll(workspaceRoot), target);
  }

  public async add(workspaceRoot: StoryUri, added: readonly StudioFollowUp[]): Promise<void> {
    if (added.length === 0) {
      return;
    }

    await this.write(workspaceRoot, addFollowUps(await this.readAll(workspaceRoot), added));
  }

  public async resolveFor(workspaceRoot: StoryUri, target: StudioEntity): Promise<void> {
    const existing = await this.readAll(workspaceRoot);
    const remaining = resolveFollowUpsFor(existing, target);

    if (remaining.length !== existing.length) {
      await this.write(workspaceRoot, remaining);
    }
  }

  public async dismiss(workspaceRoot: StoryUri, id: string): Promise<void> {
    const existing = await this.readAll(workspaceRoot);
    const remaining = removeFollowUp(existing, id);

    if (remaining.length !== existing.length) {
      await this.write(workspaceRoot, remaining);
    }
  }

  private async readAll(workspaceRoot: StoryUri): Promise<readonly StudioFollowUp[]> {
    try {
      const bytes = await this.fileSystem.readFile(followUpFileUri(workspaceRoot));
      return parseStudioFollowUps(new TextDecoder().decode(bytes));
    } catch {
      return [];
    }
  }

  private async write(
    workspaceRoot: StoryUri,
    followUps: readonly StudioFollowUp[],
  ): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.cacheDirectory);

    await this.fileSystem.writeFile(
      followUpFileUri(workspaceRoot),
      new TextEncoder().encode(serializeStudioFollowUps(followUps)),
    );
  }
}

function followUpFileUri(workspaceRoot: StoryUri): StoryUri {
  return joinStoryPath(
    getStoryboardProjectPaths(workspaceRoot).cacheDirectory,
    'studio-followups.json',
  );
}

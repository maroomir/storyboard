import {
  getStoryboardProjectPaths,
  joinStoryPath,
  serializeNarratorCard,
  type NarratorCard,
  type StoryUri,
} from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';
import { loadNarratorCards } from '#engine/persistence/narratorCards';
import type {
  CreateNarratorCardResult,
  INarratorCardRepository,
  RemoveNarratorCardResult,
} from '#engine/application/cards/narratorCardRepository';

export class NarratorCardRepository implements INarratorCardRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async list(workspaceRoot: StoryUri): Promise<ReadonlyMap<string, NarratorCard>> {
    return await loadNarratorCards(getStoryboardProjectPaths(workspaceRoot), this.fileSystem);
  }

  public async create(
    workspaceRoot: StoryUri,
    card: NarratorCard,
  ): Promise<CreateNarratorCardResult> {
    const { narratorDirectory } = getStoryboardProjectPaths(workspaceRoot);
    const uri = joinStoryPath(narratorDirectory, `${card.id}.card`);

    if (await this.fileSystem.exists(uri)) {
      return { ok: false, kind: 'exists', uri };
    }

    await this.fileSystem.createDirectory(narratorDirectory);
    await this.fileSystem.writeFile(uri, new TextEncoder().encode(serializeNarratorCard(card)));

    return { ok: true, kind: 'created', uri };
  }

  public async remove(workspaceRoot: StoryUri, id: string): Promise<RemoveNarratorCardResult> {
    const uri = joinStoryPath(
      getStoryboardProjectPaths(workspaceRoot).narratorDirectory,
      `${id}.card`,
    );

    if (!(await this.fileSystem.exists(uri))) {
      return { ok: false, kind: 'missing' };
    }

    await this.fileSystem.delete(uri);
    return { ok: true, kind: 'removed' };
  }
}

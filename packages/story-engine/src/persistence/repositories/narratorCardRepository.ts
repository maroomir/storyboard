import {
  getStoryboardProjectPaths,
  isHiddenSceneFileName,
  joinStoryPath,
  parseCardIdFromFileName,
  parseNarratorCard,
  serializeNarratorCard,
} from '@storyboard/story-model';
import type { NarratorCard, StoryUri } from '@storyboard/story-model';
import type {
  CreateNarratorCardResult,
  INarratorCardRepository,
  RemoveNarratorCardResult,
} from '#engine/application/cards/narratorCardRepository';
import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
import type { IFileSystem } from '#engine/ports/fileSystem';

export class NarratorCardRepository implements INarratorCardRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async list(workspaceRoot: StoryUri): Promise<ReadonlyMap<string, NarratorCard>> {
    const files: WorkspaceFiles = new WorkspaceFiles(this.fileSystem);
    const cards: NarratorCard[] = await files.readAll(
      getStoryboardProjectPaths(workspaceRoot).narratorDirectory,
      {
        isEligible: (fileName) =>
          !isHiddenSceneFileName(fileName) && parseCardIdFromFileName(fileName) !== undefined,
        read: async (uri) => parseNarratorCard(await files.loadText(uri)),
      },
    );

    return new Map(cards.map((card) => [card.id, card]));
  }

  public async create(
    workspaceRoot: StoryUri,
    card: NarratorCard,
  ): Promise<CreateNarratorCardResult> {
    const { narratorDirectory } = getStoryboardProjectPaths(workspaceRoot);
    const uri: StoryUri = joinStoryPath(narratorDirectory, `${card.id}.card`);

    if (await this.fileSystem.exists(uri)) {
      return { ok: false, kind: 'exists', uri };
    }

    await this.fileSystem.createDirectory(narratorDirectory);
    await this.fileSystem.writeFile(uri, new TextEncoder().encode(serializeNarratorCard(card)));
    return { ok: true, kind: 'created', uri };
  }

  public async remove(workspaceRoot: StoryUri, id: string): Promise<RemoveNarratorCardResult> {
    const uri: StoryUri = joinStoryPath(
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

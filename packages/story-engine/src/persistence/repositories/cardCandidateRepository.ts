import {
  joinStoryPath,
  type StoryUri,
  readCardFile,
  writeCardFile,
  characterCardPath,
  getStoryboardProjectPaths,
  applyCardCandidateItems,
  pruneRecordByPromotedKeys,
  type CardCandidateItem,
  readCardCandidateFile,
  writeCardCandidateFile,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { CharacterCard, CardCandidateRecord, StoryboardCard } from '@storyboard/story-model';
import type { ICardCandidateRepository } from '#engine/application/cards/cardRepositories';

export class CardCandidateRepository implements ICardCandidateRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly logger: IStoryboardLogger,
  ) {}

  public async loadRecords(workspaceRoot: StoryUri): Promise<readonly CardCandidateRecord[]> {
    const { cardCacheDirectory } = getStoryboardProjectPaths(workspaceRoot);
    const entries: FileSystemDirectoryEntry[] = await this.readDirectorySafely(cardCacheDirectory);
    const records: CardCandidateRecord[] = [];

    for (const [name, fileType] of entries) {
      if (fileType.type !== 'file' || !name.endsWith('.json')) {
        continue;
      }

      try {
        records.push(
          await readCardCandidateFile(joinStoryPath(cardCacheDirectory, name), this.fileSystem),
        );
      } catch {
        continue;
      }
    }

    return records;
  }

  public async loadCards(
    workspaceRoot: StoryUri,
    cardIds: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, CharacterCard>> {
    const cardsById: Map<string, CharacterCard> = new Map<string, CharacterCard>();

    for (const cardId of cardIds) {
      try {
        const card: StoryboardCard = await readCardFile(
          characterCardPath(workspaceRoot, cardId),
          this.fileSystem,
        );
        if (card.type === 'character') {
          cardsById.set(cardId, card);
        }
      } catch {
        continue;
      }
    }

    return cardsById;
  }

  public async apply(
    workspaceRoot: StoryUri,
    items: readonly CardCandidateItem[],
  ): Promise<number> {
    const itemsByCardId: Map<string, CardCandidateItem[]> = new Map<string, CardCandidateItem[]>();

    for (const item of items) {
      const cardItems: CardCandidateItem[] = itemsByCardId.get(item.cardId) ?? [];
      cardItems.push(item);
      itemsByCardId.set(item.cardId, cardItems);
    }

    let updatedCardCount: number = 0;

    for (const [cardId, cardItems] of itemsByCardId) {
      const cardUri: StoryUri = characterCardPath(workspaceRoot, cardId);

      try {
        const card: StoryboardCard = await readCardFile(cardUri, this.fileSystem);
        if (card.type !== 'character') {
          continue;
        }

        await writeCardFile(cardUri, this.fileSystem, applyCardCandidateItems(card, cardItems));
        updatedCardCount += 1;
      } catch (error) {
        this.logger.error(`Failed to promote candidates for card ${cardId}`, error);
      }
    }

    return updatedCardCount;
  }

  public async prune(workspaceRoot: StoryUri, promotedKeys: ReadonlySet<string>): Promise<void> {
    const { cardCacheDirectory } = getStoryboardProjectPaths(workspaceRoot);
    const entries: FileSystemDirectoryEntry[] = await this.readDirectorySafely(cardCacheDirectory);

    for (const [name, fileType] of entries) {
      if (fileType.type !== 'file' || !name.endsWith('.json')) {
        continue;
      }

      const fileUri: StoryUri = joinStoryPath(cardCacheDirectory, name);

      try {
        const record: CardCandidateRecord = await readCardCandidateFile(fileUri, this.fileSystem);
        const pruned: CardCandidateRecord = pruneRecordByPromotedKeys(record, promotedKeys);

        if (this.countCandidates(pruned) === this.countCandidates(record)) {
          continue;
        }

        if (pruned.characters.length === 0) {
          await this.fileSystem.delete(fileUri);
        } else {
          await writeCardCandidateFile(fileUri, this.fileSystem, pruned);
        }
      } catch (error) {
        this.logger.error(`Failed to prune promoted candidates in ${name}`, error);
      }
    }
  }

  private countCandidates(record: CardCandidateRecord): number {
    return record.characters.reduce(
      (total, character) =>
        total + character.attributes.length + character.relations.length + character.arc.length,
      0,
    );
  }

  private async readDirectorySafely(directory: StoryUri): Promise<FileSystemDirectoryEntry[]> {
    try {
      return await this.fileSystem.readDirectory(directory);
    } catch {
      return [];
    }
  }
}

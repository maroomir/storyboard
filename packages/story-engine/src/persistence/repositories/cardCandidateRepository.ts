import { joinStoryPath, type StoryUri } from '@storyboard/story-format';
import type { FileSystemDirectoryEntry, IFileSystem } from '../../ports/fileSystem';
import type { ICardCandidateRepository } from '../../application/cards/promoteCardCandidatesUseCase';
import type { IStoryboardLogger } from '../../ports/logger';
import { characterCardPath, getStoryboardProjectPaths } from '../../paths/projectPaths';
import {
  applyCardCandidateItems,
  pruneRecordByPromotedKeys,
  type CardCandidateItem,
} from '../../domain/cardCandidatePromotion';
import { readCardFile, writeCardFile } from '@storyboard/story-format';
import type { CharacterCard } from '@storyboard/story-format';
import { readCardCandidateFile, writeCardCandidateFile } from '../../domain/files/cardCandidates';
import type { CardCandidateRecord } from '../../shared/cardCandidates';

export class CardCandidateRepository implements ICardCandidateRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly logger: IStoryboardLogger,
  ) {}

  public async loadRecords(workspaceRoot: StoryUri): Promise<readonly CardCandidateRecord[]> {
    const { cardCacheDirectory } = getStoryboardProjectPaths(workspaceRoot);
    const entries = await this.readDirectorySafely(cardCacheDirectory);
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
        // NOTE: Invalid cache records are excluded from candidate promotion.
      }
    }

    return records;
  }

  public async loadCards(
    workspaceRoot: StoryUri,
    cardIds: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, CharacterCard>> {
    const cardsById = new Map<string, CharacterCard>();

    for (const cardId of cardIds) {
      try {
        const card = await readCardFile(characterCardPath(workspaceRoot, cardId), this.fileSystem);
        if (card.type === 'character') {
          cardsById.set(cardId, card);
        }
      } catch {
        // NOTE: Missing cards leave their candidates available for promotion.
      }
    }

    return cardsById;
  }

  public async apply(
    workspaceRoot: StoryUri,
    items: readonly CardCandidateItem[],
  ): Promise<number> {
    const itemsByCardId = new Map<string, CardCandidateItem[]>();

    for (const item of items) {
      const cardItems = itemsByCardId.get(item.cardId) ?? [];
      cardItems.push(item);
      itemsByCardId.set(item.cardId, cardItems);
    }

    let updatedCardCount = 0;

    for (const [cardId, cardItems] of itemsByCardId) {
      const cardUri = characterCardPath(workspaceRoot, cardId);

      try {
        const card = await readCardFile(cardUri, this.fileSystem);
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
    const entries = await this.readDirectorySafely(cardCacheDirectory);

    for (const [name, fileType] of entries) {
      if (fileType.type !== 'file' || !name.endsWith('.json')) {
        continue;
      }

      const fileUri = joinStoryPath(cardCacheDirectory, name);

      try {
        const record = await readCardCandidateFile(fileUri, this.fileSystem);
        const pruned = pruneRecordByPromotedKeys(record, promotedKeys);

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

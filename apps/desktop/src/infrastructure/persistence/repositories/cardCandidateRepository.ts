import * as vscode from 'vscode';

import type { ICardCandidateRepository } from '../../../application/cards/promoteCardCandidatesUseCase';
import type { StoryboardLogger } from '../../vscode/logger';
import { characterCardPath, getStoryboardProjectPaths } from '../../vscode/pathConventions';
import {
  applyCardCandidateItems,
  pruneRecordByPromotedKeys,
  type CardCandidateItem,
} from '../../../domain/cardCandidatePromotion';
import { readCardFile, writeCardFile } from '@/domain/files/storyFiles';
import type { CharacterCard } from '@seedkernel/wasm';
import {
  readCardCandidateFile,
  writeCardCandidateFile,
} from '../../../domain/files/cardCandidates';
import type { CardCandidateRecord } from '../../../shared/cardCandidates';

const VSCODE_FILE_SYSTEM = {
  readFile: (uri: unknown): Thenable<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): Thenable<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export class CardCandidateRepository implements ICardCandidateRepository {
  public constructor(private readonly logger: StoryboardLogger) {}

  public async loadRecords(workspaceRoot: vscode.Uri): Promise<readonly CardCandidateRecord[]> {
    const { cardCacheDirectory } = getStoryboardProjectPaths(workspaceRoot);
    const entries = await this.readDirectorySafely(cardCacheDirectory);
    const records: CardCandidateRecord[] = [];

    for (const [name, fileType] of entries) {
      if (fileType !== vscode.FileType.File || !name.endsWith('.json')) {
        continue;
      }

      try {
        records.push(
          await readCardCandidateFile(
            vscode.Uri.joinPath(cardCacheDirectory, name),
            VSCODE_FILE_SYSTEM,
          ),
        );
      } catch {
        // NOTE: Invalid cache records are excluded from candidate promotion.
      }
    }

    return records;
  }

  public async loadCards(
    workspaceRoot: vscode.Uri,
    cardIds: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, CharacterCard>> {
    const cardsById = new Map<string, CharacterCard>();

    for (const cardId of cardIds) {
      try {
        const card = await readCardFile(
          characterCardPath(workspaceRoot, cardId),
          VSCODE_FILE_SYSTEM,
        );
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
    workspaceRoot: vscode.Uri,
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
        const card = await readCardFile(cardUri, VSCODE_FILE_SYSTEM);
        if (card.type !== 'character') {
          continue;
        }

        await writeCardFile(cardUri, VSCODE_FILE_SYSTEM, applyCardCandidateItems(card, cardItems));
        updatedCardCount += 1;
      } catch (error) {
        this.logger.error(`Failed to promote candidates for card ${cardId}`, error);
      }
    }

    return updatedCardCount;
  }

  public async prune(workspaceRoot: vscode.Uri, promotedKeys: ReadonlySet<string>): Promise<void> {
    const { cardCacheDirectory } = getStoryboardProjectPaths(workspaceRoot);
    const entries = await this.readDirectorySafely(cardCacheDirectory);

    for (const [name, fileType] of entries) {
      if (fileType !== vscode.FileType.File || !name.endsWith('.json')) {
        continue;
      }

      const fileUri = vscode.Uri.joinPath(cardCacheDirectory, name);

      try {
        const record = await readCardCandidateFile(fileUri, VSCODE_FILE_SYSTEM);
        const pruned = pruneRecordByPromotedKeys(record, promotedKeys);

        if (this.countCandidates(pruned) === this.countCandidates(record)) {
          continue;
        }

        if (pruned.characters.length === 0) {
          await vscode.workspace.fs.delete(fileUri);
        } else {
          await writeCardCandidateFile(fileUri, VSCODE_FILE_SYSTEM, pruned);
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

  private async readDirectorySafely(directory: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
      return await vscode.workspace.fs.readDirectory(directory);
    } catch {
      return [];
    }
  }
}

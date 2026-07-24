import type * as vscode from 'vscode';

import {
  cardCandidateItemKey,
  collectCardCandidateItems,
  selectNewCardCandidateItems,
  type CardCandidateItem,
} from '../../domain/cardCandidatePromotion';
import type { CharacterCard } from '@storyboard/story-format';
import type { CardCandidateRecord } from '../../shared/cardCandidates';

export interface ICardCandidateRepository {
  apply(workspaceRoot: vscode.Uri, items: readonly CardCandidateItem[]): Promise<number>;
  loadCards(
    workspaceRoot: vscode.Uri,
    cardIds: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, CharacterCard>>;
  loadRecords(workspaceRoot: vscode.Uri): Promise<readonly CardCandidateRecord[]>;
  prune(workspaceRoot: vscode.Uri, promotedKeys: ReadonlySet<string>): Promise<void>;
}

export type PrepareCardCandidatePromotionResult =
  | { readonly items: readonly CardCandidateItem[]; readonly kind: 'ready' }
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' };

export type PromoteCardCandidatesResult =
  | { readonly kind: 'save_failed'; readonly updatedCardCount: 0 }
  | { readonly kind: 'promoted'; readonly updatedCardCount: number };

export class PromoteCardCandidatesUseCase {
  public constructor(private readonly repository: ICardCandidateRepository) {}

  public async prepare(workspaceRoot: vscode.Uri): Promise<PrepareCardCandidatePromotionResult> {
    const items = collectCardCandidateItems(await this.repository.loadRecords(workspaceRoot));

    if (items.length === 0) {
      return { kind: 'no_candidates' };
    }

    const cards = await this.repository.loadCards(
      workspaceRoot,
      new Set(items.map((item) => item.cardId)),
    );
    const newItems = selectNewCardCandidateItems(items, cards);

    return newItems.length === 0
      ? { kind: 'no_new_candidates' }
      : { items: newItems, kind: 'ready' };
  }

  public async promote(
    workspaceRoot: vscode.Uri,
    items: readonly CardCandidateItem[],
  ): Promise<PromoteCardCandidatesResult> {
    const updatedCardCount = await this.repository.apply(workspaceRoot, items);

    if (updatedCardCount === 0) {
      return { kind: 'save_failed', updatedCardCount };
    }

    await this.repository.prune(workspaceRoot, new Set(items.map(cardCandidateItemKey)));

    return { kind: 'promoted', updatedCardCount };
  }
}

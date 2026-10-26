import type { WorkspaceRepositories } from '#engine/application/engineServices';
import {
  cardCandidateItemKey,
  collectCardCandidateItems,
  selectNewCardCandidateItems,
  type CardCandidateItem,
} from '@storyboard/story-model';
import type { CharacterCard, StoryUri } from '@storyboard/story-model';

export type PrepareCardCandidatePromotionResult =
  | { readonly items: readonly CardCandidateItem[]; readonly kind: 'ready' }
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' };

export type PromoteCardCandidatesResult =
  | { readonly kind: 'save_failed'; readonly updatedCardCount: 0 }
  | { readonly kind: 'promoted'; readonly updatedCardCount: number };

export class PromoteCardCandidatesUseCase {
  public constructor(private readonly repositories: WorkspaceRepositories) {}

  public async prepare(workspaceRoot: StoryUri): Promise<PrepareCardCandidatePromotionResult> {
    const items: CardCandidateItem[] = collectCardCandidateItems(
      await this.repositories.cardCandidates.loadRecords(workspaceRoot),
    );

    if (items.length === 0) {
      return { kind: 'no_candidates' };
    }

    const cards: ReadonlyMap<string, CharacterCard> =
      await this.repositories.cardCandidates.loadCards(
        workspaceRoot,
        new Set(items.map((item) => item.cardId)),
      );
    const newItems: CardCandidateItem[] = selectNewCardCandidateItems(items, cards);

    return newItems.length === 0
      ? { kind: 'no_new_candidates' }
      : { items: newItems, kind: 'ready' };
  }

  public async promote(
    workspaceRoot: StoryUri,
    items: readonly CardCandidateItem[],
  ): Promise<PromoteCardCandidatesResult> {
    const updatedCardCount: number = await this.repositories.cardCandidates.apply(
      workspaceRoot,
      items,
    );

    if (updatedCardCount === 0) {
      return { kind: 'save_failed', updatedCardCount };
    }

    await this.repositories.cardCandidates.prune(
      workspaceRoot,
      new Set(items.map(cardCandidateItemKey)),
    );

    return { kind: 'promoted', updatedCardCount };
  }

  public async discard(
    workspaceRoot: StoryUri,
    cardIds: ReadonlySet<string> | undefined,
  ): Promise<number> {
    const items: CardCandidateItem[] = collectCardCandidateItems(
      await this.repositories.cardCandidates.loadRecords(workspaceRoot),
    ).filter((item) => cardIds === undefined || cardIds.has(item.cardId));

    if (items.length > 0) {
      await this.repositories.cardCandidates.prune(
        workspaceRoot,
        new Set(items.map(cardCandidateItemKey)),
      );
    }

    return items.length;
  }
}

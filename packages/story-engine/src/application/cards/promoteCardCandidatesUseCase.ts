import {
  cardCandidateItemKey,
  collectCardCandidateItems,
  selectNewCardCandidateItems,
  type CardCandidateItem,
} from '#engine/domain/cardCandidatePromotion';
import type { CharacterCard, StoryUri } from '@storyboard/story-model';
import type { CardCandidateRecord } from '#engine/shared/cardCandidates';

export interface ICardCandidateRepository {
  apply(workspaceRoot: StoryUri, items: readonly CardCandidateItem[]): Promise<number>;
  loadCards(
    workspaceRoot: StoryUri,
    cardIds: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, CharacterCard>>;
  loadRecords(workspaceRoot: StoryUri): Promise<readonly CardCandidateRecord[]>;
  prune(workspaceRoot: StoryUri, promotedKeys: ReadonlySet<string>): Promise<void>;
}

export type PrepareCardCandidatePromotionResult =
  | { readonly items: readonly CardCandidateItem[]; readonly kind: 'ready' }
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' };

export type PromoteCardCandidatesResult =
  | { readonly kind: 'save_failed'; readonly updatedCardCount: 0 }
  | { readonly kind: 'promoted'; readonly updatedCardCount: number };

export interface PromoteCardCandidatesUseCaseDependencies {
  readonly repository: ICardCandidateRepository;
}

export class PromoteCardCandidatesUseCase {
  public constructor(private readonly deps: PromoteCardCandidatesUseCaseDependencies) {}

  public async prepare(workspaceRoot: StoryUri): Promise<PrepareCardCandidatePromotionResult> {
    const items = collectCardCandidateItems(await this.deps.repository.loadRecords(workspaceRoot));

    if (items.length === 0) {
      return { kind: 'no_candidates' };
    }

    const cards = await this.deps.repository.loadCards(
      workspaceRoot,
      new Set(items.map((item) => item.cardId)),
    );
    const newItems = selectNewCardCandidateItems(items, cards);

    return newItems.length === 0
      ? { kind: 'no_new_candidates' }
      : { items: newItems, kind: 'ready' };
  }

  public async promote(
    workspaceRoot: StoryUri,
    items: readonly CardCandidateItem[],
  ): Promise<PromoteCardCandidatesResult> {
    const updatedCardCount = await this.deps.repository.apply(workspaceRoot, items);

    if (updatedCardCount === 0) {
      return { kind: 'save_failed', updatedCardCount };
    }

    await this.deps.repository.prune(workspaceRoot, new Set(items.map(cardCandidateItemKey)));

    return { kind: 'promoted', updatedCardCount };
  }
}

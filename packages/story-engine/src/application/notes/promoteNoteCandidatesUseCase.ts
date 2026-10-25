import type {
  CardCollectProposal,
  MergedNoteCardCandidate,
  NoteCandidateFile,
  StoryboardCard,
  StoryUri,
} from '@storyboard/story-model';

import type { ICardWriterRepository } from '#engine/application/cards/createCardUseCase';
import {
  applyCardCollectProposals,
  emptyNoteCandidateFile,
  keepNoteCandidateConflicts,
  mergeNoteCandidateSources,
  removeNoteCandidateCards,
  removeNoteCandidateChange,
  shouldProposeCardCollect,
} from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { INoteAbsorbRepository, NoteCandidateLoad } from './noteAbsorbRepository';

export type PrepareNoteCandidatePromotionResult =
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' }
  | {
      readonly kind: 'ready';
      readonly candidates: readonly MergedNoteCardCandidate[];
      readonly heldCards: readonly MergedNoteCardCandidate[];
    };

export interface PromoteNoteCandidatesResult {
  readonly updatedCardIds: readonly string[];
}

export type DiscardNoteCandidatesRequest =
  | { readonly kind: 'cards'; readonly cardIds?: ReadonlySet<string> }
  | { readonly kind: 'change'; readonly cardId: string; readonly ref: string };

export type DiscardNoteCandidatesResult =
  | { readonly kind: 'discarded'; readonly cardIds: readonly string[] }
  | { readonly kind: 'change_not_found' };

export interface PromoteNoteCandidatesUseCaseDependencies {
  readonly logger: IStoryboardLogger;
  readonly noteRepository: INoteAbsorbRepository;
  readonly cardWriter: ICardWriterRepository;
}

export class PromoteNoteCandidatesUseCase {
  public constructor(private readonly deps: PromoteNoteCandidatesUseCaseDependencies) {}

  public async prepare(workspaceRoot: StoryUri): Promise<PrepareNoteCandidatePromotionResult> {
    const file: NoteCandidateFile = await this.loadFile(workspaceRoot);

    if (file.sources.length === 0) {
      return { kind: 'no_candidates' };
    }

    const candidates: MergedNoteCardCandidate[] = [];
    const heldCards: MergedNoteCardCandidate[] = [];

    for (const candidate of mergeNoteCandidateSources(file.sources)) {
      const card: StoryboardCard | undefined = await this.deps.noteRepository.loadCard(
        workspaceRoot,
        candidate.cardType,
        candidate.cardId,
      );
      const changes: CardCollectProposal[] =
        card === undefined
          ? []
          : candidate.changes.filter((change) => shouldProposeCardCollect(card, change));

      if (changes.length > 0) {
        candidates.push({ ...candidate, changes });
      } else if (card !== undefined && candidate.conflicts.length > 0) {
        heldCards.push({ ...candidate, changes });
      }
    }

    return candidates.length === 0 && heldCards.length === 0
      ? { kind: 'no_new_candidates' }
      : { kind: 'ready', candidates, heldCards };
  }

  public async promote(
    workspaceRoot: StoryUri,
    candidates: readonly MergedNoteCardCandidate[],
  ): Promise<PromoteNoteCandidatesResult> {
    const updatedCardIds: string[] = [];
    let file: NoteCandidateFile = await this.loadFile(workspaceRoot);

    for (const candidate of candidates) {
      const card: StoryboardCard | undefined = await this.deps.noteRepository.loadCard(
        workspaceRoot,
        candidate.cardType,
        candidate.cardId,
      );

      if (card === undefined) {
        continue;
      }

      await this.deps.cardWriter.write(
        workspaceRoot,
        applyCardCollectProposals(card, candidate.changes),
      );
      updatedCardIds.push(candidate.cardId);
      file = keepNoteCandidateConflicts(file, candidate);
    }

    await this.deps.noteRepository.saveCandidates(workspaceRoot, file);

    return { updatedCardIds };
  }

  public async discard(
    workspaceRoot: StoryUri,
    request: DiscardNoteCandidatesRequest,
  ): Promise<DiscardNoteCandidatesResult> {
    const file: NoteCandidateFile = await this.loadFile(workspaceRoot);
    const next: NoteCandidateFile | undefined =
      request.kind === 'cards'
        ? removeNoteCandidateCards(file, request.cardIds)
        : removeNoteCandidateChange(file, request.cardId, request.ref);

    if (next === undefined) {
      return { kind: 'change_not_found' };
    }

    await this.deps.noteRepository.saveCandidates(workspaceRoot, next);

    const before: string[] = mergeNoteCandidateSources(file.sources).map((card) => card.cardId);
    const remaining: Set<string> = new Set(
      mergeNoteCandidateSources(next.sources).map((card) => card.cardId),
    );

    return {
      kind: 'discarded',
      cardIds:
        request.kind === 'change'
          ? [request.cardId]
          : before.filter((cardId) => !remaining.has(cardId)),
    };
  }

  private async loadFile(workspaceRoot: StoryUri): Promise<NoteCandidateFile> {
    const loaded: NoteCandidateLoad = await this.deps.noteRepository.loadCandidates(workspaceRoot);

    if (loaded.kind === 'legacy') {
      this.deps.logger.warn(
        '이전 버전이 남긴 노트 카드 후보는 읽지 않습니다. 필요하면 그 노트를 다시 흡수하세요.',
      );
    }

    return loaded.kind === 'current' ? loaded.file : emptyNoteCandidateFile;
  }
}

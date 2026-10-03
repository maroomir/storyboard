import type { StoryUri, NoteCardCandidate } from '@storyboard/story-model';

import type { ICardWriterRepository } from '#engine/application/cards/createCardUseCase';
import { applyCardCollectProposals, shouldProposeCardCollect } from '@storyboard/story-model';
import type { INoteAbsorbRepository } from './noteAbsorbRepository';

export type PrepareNoteCandidatePromotionResult =
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' }
  | {
      readonly kind: 'ready';
      readonly location: string;
      readonly candidates: readonly NoteCardCandidate[];
    };

export interface PromoteNoteCandidatesResult {
  readonly updatedCardIds: readonly string[];
}

export interface PromoteNoteCandidatesUseCaseDependencies {
  readonly noteRepository: INoteAbsorbRepository;
  readonly cardWriter: ICardWriterRepository;
}

// Candidates from notes about cards that already existed. `card promote` reads these beside the
// candidates generation leaves, so the author has one verb for both.
export class PromoteNoteCandidatesUseCase {
  public constructor(private readonly deps: PromoteNoteCandidatesUseCaseDependencies) {}

  public async prepare(workspaceRoot: StoryUri): Promise<PrepareNoteCandidatePromotionResult> {
    const file = await this.deps.noteRepository.loadCandidates(workspaceRoot);

    if (file === undefined || file.candidates.length === 0) {
      return { kind: 'no_candidates' };
    }

    const candidates: NoteCardCandidate[] = [];

    for (const candidate of file.candidates) {
      const card = await this.deps.noteRepository.loadCard(
        workspaceRoot,
        candidate.cardType,
        candidate.cardId,
      );
      // The card may have been edited since the absorb; only what it still lacks is offered.
      const changes =
        card === undefined
          ? []
          : candidate.changes.filter((change) => shouldProposeCardCollect(card, change));

      if (changes.length > 0) {
        candidates.push({ ...candidate, changes });
      }
    }

    return candidates.length === 0
      ? { kind: 'no_new_candidates' }
      : { kind: 'ready', location: file.location, candidates };
  }

  public async promote(
    workspaceRoot: StoryUri,
    candidates: readonly NoteCardCandidate[],
  ): Promise<PromoteNoteCandidatesResult> {
    const updatedCardIds: string[] = [];

    for (const candidate of candidates) {
      const card = await this.deps.noteRepository.loadCard(
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
    }

    const file = await this.deps.noteRepository.loadCandidates(workspaceRoot);

    if (file !== undefined) {
      const promoted = new Set(updatedCardIds);
      await this.deps.noteRepository.saveCandidates(workspaceRoot, {
        ...file,
        candidates: file.candidates.filter((candidate) => !promoted.has(candidate.cardId)),
      });
    }

    return { updatedCardIds };
  }
}

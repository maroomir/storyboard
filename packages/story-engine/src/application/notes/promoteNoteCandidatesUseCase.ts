import type { MergedNoteCardCandidate, NoteCandidateFile, StoryUri } from '@storyboard/story-model';

import type { ICardWriterRepository } from '#engine/application/cards/createCardUseCase';
import {
  applyCardCollectProposals,
  emptyNoteCandidateFile,
  keepNoteCandidateConflicts,
  mergeNoteCandidateSources,
  shouldProposeCardCollect,
} from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { INoteAbsorbRepository } from './noteAbsorbRepository';

export type PrepareNoteCandidatePromotionResult =
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' }
  | {
      readonly kind: 'ready';
      // Cards with something to apply, each with the conflicts it still holds.
      readonly candidates: readonly MergedNoteCardCandidate[];
      // Cards whose only candidates are conflicts: nothing applies until one value is discarded.
      readonly heldCards: readonly MergedNoteCardCandidate[];
    };

export interface PromoteNoteCandidatesResult {
  readonly updatedCardIds: readonly string[];
}

export interface PromoteNoteCandidatesUseCaseDependencies {
  readonly logger: IStoryboardLogger;
  readonly noteRepository: INoteAbsorbRepository;
  readonly cardWriter: ICardWriterRepository;
}

// Candidates from notes about cards that already existed. `card promote` reads these beside the
// candidates generation leaves, so the author has one verb for both.
export class PromoteNoteCandidatesUseCase {
  public constructor(private readonly deps: PromoteNoteCandidatesUseCaseDependencies) {}

  public async prepare(workspaceRoot: StoryUri): Promise<PrepareNoteCandidatePromotionResult> {
    const file = await this.loadFile(workspaceRoot);

    if (file.sources.length === 0) {
      return { kind: 'no_candidates' };
    }

    const candidates: MergedNoteCardCandidate[] = [];
    const heldCards: MergedNoteCardCandidate[] = [];

    for (const candidate of mergeNoteCandidateSources(file.sources)) {
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
    let file = await this.loadFile(workspaceRoot);

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
      file = keepNoteCandidateConflicts(file, candidate);
    }

    await this.deps.noteRepository.saveCandidates(workspaceRoot, file);

    return { updatedCardIds };
  }

  private async loadFile(workspaceRoot: StoryUri): Promise<NoteCandidateFile> {
    const loaded = await this.deps.noteRepository.loadCandidates(workspaceRoot);

    if (loaded.kind === 'legacy') {
      this.deps.logger.warn(
        '이전 버전이 남긴 노트 카드 후보는 읽지 않습니다. 필요하면 그 노트를 다시 흡수하세요.',
      );
    }

    return loaded.kind === 'current' ? loaded.file : emptyNoteCandidateFile;
  }
}

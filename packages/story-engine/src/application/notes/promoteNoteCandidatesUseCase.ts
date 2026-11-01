import type { HostAdapters, WorkspaceRepositories } from '#engine/application/engineServices';
import type {
  CardCollectProposal,
  MergedNoteCardCandidate,
  NoteCandidateFile,
  NoteCandidateSource,
  StoryboardCard,
  StoryUri,
} from '@storyboard/story-model';

import {
  applyCardCollectProposals,
  emptyNoteCandidateFile,
  keepNoteCandidateConflicts,
  mergeNoteCandidateSources,
  removeNoteCandidateCards,
  removeNoteCandidateChange,
  shouldProposeCardCollect,
} from '@storyboard/story-model';
import type { NoteCandidateLoad } from '#engine/application/notes/noteAbsorbRepository';

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

type CandidateOrigin = 'notes' | 'interviews';

const interviewSourcePrefix: string = 'interview/';

interface CandidateFiles {
  readonly notes: NoteCandidateFile;
  readonly interviews: NoteCandidateFile;
}

function mergedSources(files: CandidateFiles): NoteCandidateSource[] {
  return [
    ...files.notes.sources,
    ...files.interviews.sources.map((source) => ({
      ...source,
      id: `${interviewSourcePrefix}${source.id}`,
    })),
  ];
}

function splitRef(ref: string): { readonly origin: CandidateOrigin; readonly ref: string } {
  return ref.startsWith(interviewSourcePrefix)
    ? { origin: 'interviews', ref: ref.slice(interviewSourcePrefix.length) }
    : { origin: 'notes', ref };
}

export class PromoteNoteCandidatesUseCase {
  public constructor(
    private readonly host: HostAdapters,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async prepare(workspaceRoot: StoryUri): Promise<PrepareNoteCandidatePromotionResult> {
    const sources: NoteCandidateSource[] = mergedSources(await this.loadFiles(workspaceRoot));

    if (sources.length === 0) {
      return { kind: 'no_candidates' };
    }

    const candidates: MergedNoteCardCandidate[] = [];
    const heldCards: MergedNoteCardCandidate[] = [];

    for (const candidate of mergeNoteCandidateSources(sources)) {
      const card: StoryboardCard | undefined = await this.repositories.noteAbsorb.loadCard(
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
    let files: CandidateFiles = await this.loadFiles(workspaceRoot);

    for (const candidate of candidates) {
      const card: StoryboardCard | undefined = await this.repositories.noteAbsorb.loadCard(
        workspaceRoot,
        candidate.cardType,
        candidate.cardId,
      );

      if (card === undefined) {
        continue;
      }

      await this.repositories.cardWriter.write(
        workspaceRoot,
        applyCardCollectProposals(card, candidate.changes),
      );
      updatedCardIds.push(candidate.cardId);
      files = {
        notes: keepNoteCandidateConflicts(files.notes, candidate),
        interviews: keepNoteCandidateConflicts(files.interviews, candidate),
      };
    }

    await this.saveFiles(workspaceRoot, files);

    return { updatedCardIds };
  }

  public async discard(
    workspaceRoot: StoryUri,
    request: DiscardNoteCandidatesRequest,
  ): Promise<DiscardNoteCandidatesResult> {
    const files: CandidateFiles = await this.loadFiles(workspaceRoot);
    const next: CandidateFiles | undefined = this.discardFrom(files, request);

    if (next === undefined) {
      return { kind: 'change_not_found' };
    }

    await this.saveFiles(workspaceRoot, next);

    const before: string[] = mergeNoteCandidateSources(mergedSources(files)).map((card) => card.cardId);
    const remaining: Set<string> = new Set(
      mergeNoteCandidateSources(mergedSources(next)).map((card) => card.cardId),
    );

    return {
      kind: 'discarded',
      cardIds:
        request.kind === 'change'
          ? [request.cardId]
          : before.filter((cardId) => !remaining.has(cardId)),
    };
  }

  private discardFrom(
    files: CandidateFiles,
    request: DiscardNoteCandidatesRequest,
  ): CandidateFiles | undefined {
    if (request.kind === 'cards') {
      return {
        notes: removeNoteCandidateCards(files.notes, request.cardIds),
        interviews: removeNoteCandidateCards(files.interviews, request.cardIds),
      };
    }

    const { origin, ref } = splitRef(request.ref);
    const next: NoteCandidateFile | undefined = removeNoteCandidateChange(
      files[origin],
      request.cardId,
      ref,
    );

    return next === undefined ? undefined : { ...files, [origin]: next };
  }

  private async loadFiles(workspaceRoot: StoryUri): Promise<CandidateFiles> {
    const loaded: NoteCandidateLoad =
      await this.repositories.noteAbsorb.loadCandidates(workspaceRoot);

    if (loaded.kind === 'legacy') {
      this.host.logger.warn(
        '이전 버전이 남긴 노트 카드 후보는 읽지 않습니다. 필요하면 그 노트를 다시 흡수하세요.',
      );
    }

    return {
      notes: loaded.kind === 'current' ? loaded.file : emptyNoteCandidateFile,
      interviews: await this.repositories.interviews.loadCandidates(workspaceRoot),
    };
  }

  private async saveFiles(workspaceRoot: StoryUri, files: CandidateFiles): Promise<void> {
    await this.repositories.noteAbsorb.saveCandidates(workspaceRoot, files.notes);
    await this.repositories.interviews.saveCandidates(workspaceRoot, files.interviews);
  }
}

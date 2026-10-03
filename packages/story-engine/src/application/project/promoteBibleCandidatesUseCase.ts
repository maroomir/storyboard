import {
  aggregateCandidateFacts,
  mergeCanonFacts,
  seedPromotedFact,
  selectNewCandidates,
} from '#engine/domain/biblePromotion';
import type { BibleCandidateRecord } from '#engine/domain/files/bibleCandidates';
import type { StoryUri, BibleFact, StoryBible } from '@storyboard/story-model';

export interface IBibleCandidateRepository {
  loadCanon(workspaceRoot: StoryUri): Promise<StoryBible>;
  loadRecords(workspaceRoot: StoryUri): Promise<readonly BibleCandidateRecord[]>;
  saveCanon(workspaceRoot: StoryUri, canon: StoryBible): Promise<void>;
}

export type PrepareBibleCandidatePromotionResult =
  | { readonly facts: readonly BibleFact[]; readonly kind: 'ready' }
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' };

export interface PromoteBibleCandidatesUseCaseDependencies {
  readonly repository: IBibleCandidateRepository;
}

export class PromoteBibleCandidatesUseCase {
  public constructor(private readonly deps: PromoteBibleCandidatesUseCaseDependencies) {}

  public async prepare(workspaceRoot: StoryUri): Promise<PrepareBibleCandidatePromotionResult> {
    const candidates = aggregateCandidateFacts(
      await this.deps.repository.loadRecords(workspaceRoot),
    );

    if (candidates.length === 0) {
      return { kind: 'no_candidates' };
    }

    const facts = selectNewCandidates(
      candidates,
      await this.deps.repository.loadCanon(workspaceRoot),
    );

    return facts.length === 0 ? { kind: 'no_new_candidates' } : { facts, kind: 'ready' };
  }

  public async promote(workspaceRoot: StoryUri, facts: readonly BibleFact[]): Promise<void> {
    const canon = await this.deps.repository.loadCanon(workspaceRoot);
    const nextCanon = mergeCanonFacts(canon, facts.map(seedPromotedFact));

    await this.deps.repository.saveCanon(workspaceRoot, nextCanon);
  }
}

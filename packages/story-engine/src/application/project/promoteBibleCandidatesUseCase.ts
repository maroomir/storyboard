import {
  aggregateCandidateFacts,
  mergeCanonFacts,
  seedPromotedFact,
  selectNewCandidates,
} from '../../domain/biblePromotion';
import type { BibleCandidateRecord } from '../../domain/files/bibleCandidates';
import type { StoryUri } from '../../paths/storyUri';
import type { BibleFact, StoryBible } from '@storyboard/story-format';

export interface IBibleCandidateRepository {
  loadCanon(workspaceRoot: StoryUri): Promise<StoryBible>;
  loadRecords(workspaceRoot: StoryUri): Promise<readonly BibleCandidateRecord[]>;
  saveCanon(workspaceRoot: StoryUri, canon: StoryBible): Promise<void>;
}

export type PrepareBibleCandidatePromotionResult =
  | { readonly facts: readonly BibleFact[]; readonly kind: 'ready' }
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' };

export class PromoteBibleCandidatesUseCase {
  public constructor(private readonly repository: IBibleCandidateRepository) {}

  public async prepare(workspaceRoot: StoryUri): Promise<PrepareBibleCandidatePromotionResult> {
    const candidates = aggregateCandidateFacts(await this.repository.loadRecords(workspaceRoot));

    if (candidates.length === 0) {
      return { kind: 'no_candidates' };
    }

    const facts = selectNewCandidates(candidates, await this.repository.loadCanon(workspaceRoot));

    return facts.length === 0 ? { kind: 'no_new_candidates' } : { facts, kind: 'ready' };
  }

  public async promote(workspaceRoot: StoryUri, facts: readonly BibleFact[]): Promise<void> {
    const canon = await this.repository.loadCanon(workspaceRoot);
    const nextCanon = mergeCanonFacts(canon, facts.map(seedPromotedFact));

    await this.repository.saveCanon(workspaceRoot, nextCanon);
  }
}

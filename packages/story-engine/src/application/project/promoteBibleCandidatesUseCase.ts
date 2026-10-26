import type { WorkspaceRepositories } from '#engine/application/engineServices';
import {
  aggregateCandidateFacts,
  mergeCanonFacts,
  seedPromotedFact,
  selectNewCandidates,
} from '@storyboard/story-model';
import type { StoryUri, BibleFact, StoryBible } from '@storyboard/story-model';

export type PrepareBibleCandidatePromotionResult =
  | { readonly facts: readonly BibleFact[]; readonly kind: 'ready' }
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' };

export class PromoteBibleCandidatesUseCase {
  public constructor(private readonly repositories: WorkspaceRepositories) {}

  public async prepare(workspaceRoot: StoryUri): Promise<PrepareBibleCandidatePromotionResult> {
    const candidates: BibleFact[] = aggregateCandidateFacts(
      await this.repositories.bibleCandidates.loadRecords(workspaceRoot),
    );

    if (candidates.length === 0) {
      return { kind: 'no_candidates' };
    }

    const facts: BibleFact[] = selectNewCandidates(
      candidates,
      await this.repositories.bibleCandidates.loadCanon(workspaceRoot),
    );

    return facts.length === 0 ? { kind: 'no_new_candidates' } : { facts, kind: 'ready' };
  }

  public async promote(workspaceRoot: StoryUri, facts: readonly BibleFact[]): Promise<void> {
    const canon: StoryBible = await this.repositories.bibleCandidates.loadCanon(workspaceRoot);
    const nextCanon: StoryBible = mergeCanonFacts(canon, facts.map(seedPromotedFact));

    await this.repositories.bibleCandidates.saveCanon(workspaceRoot, nextCanon);
  }
}

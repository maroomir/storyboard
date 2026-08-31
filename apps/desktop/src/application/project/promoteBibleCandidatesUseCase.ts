import type * as vscode from 'vscode';

import {
  aggregateCandidateFacts,
  mergeCanonFacts,
  seedPromotedFact,
  selectNewCandidates,
} from '@storyboard/story-engine';
import type { BibleCandidateRecord } from '@storyboard/story-engine';
import type { BibleFact, StoryBible } from '@storyboard/story-format';

export interface IBibleCandidateRepository {
  loadCanon(workspaceRoot: vscode.Uri): Promise<StoryBible>;
  loadRecords(workspaceRoot: vscode.Uri): Promise<readonly BibleCandidateRecord[]>;
  saveCanon(workspaceRoot: vscode.Uri, canon: StoryBible): Promise<void>;
}

export type PrepareBibleCandidatePromotionResult =
  | { readonly facts: readonly BibleFact[]; readonly kind: 'ready' }
  | { readonly kind: 'no_candidates' }
  | { readonly kind: 'no_new_candidates' };

export class PromoteBibleCandidatesUseCase {
  public constructor(private readonly repository: IBibleCandidateRepository) {}

  public async prepare(workspaceRoot: vscode.Uri): Promise<PrepareBibleCandidatePromotionResult> {
    const candidates = aggregateCandidateFacts(await this.repository.loadRecords(workspaceRoot));

    if (candidates.length === 0) {
      return { kind: 'no_candidates' };
    }

    const facts = selectNewCandidates(candidates, await this.repository.loadCanon(workspaceRoot));

    return facts.length === 0 ? { kind: 'no_new_candidates' } : { facts, kind: 'ready' };
  }

  public async promote(workspaceRoot: vscode.Uri, facts: readonly BibleFact[]): Promise<void> {
    const canon = await this.repository.loadCanon(workspaceRoot);
    const nextCanon = mergeCanonFacts(canon, facts.map(seedPromotedFact));

    await this.repository.saveCanon(workspaceRoot, nextCanon);
  }
}

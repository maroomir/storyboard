import type { InterviewDistillDraft } from '@storyboard/story-ai';
import type {
  BibleSubjectKind,
  CardCollectProposalDraft,
  StoryboardCard,
  StoryUri,
} from '@storyboard/story-model';

import {
  otherPlaceTokens,
  type BeatSituationOptions,
} from '#engine/application/interviews/interviewCoverage';
import { ReactionInterviewStrategy } from '#engine/application/interviews/reactionInterviewStrategy';

export class BackgroundInterviewStrategy extends ReactionInterviewStrategy {
  protected readonly cardKind: BibleSubjectKind = 'background';

  protected override async situationOptionsFor(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
  ): Promise<BeatSituationOptions> {
    return { otherPlaceTokens: otherPlaceTokens(card, await this.loadCards(workspaceRoot, 'background')) };
  }

  protected proposalDraftsFrom(distilled: InterviewDistillDraft): CardCollectProposalDraft[] {
    return [
      ...distilled.layout.map((value): CardCollectProposalDraft => ({ kind: 'layoutLine', value })),
      ...distilled.rules.map((value): CardCollectProposalDraft => ({ kind: 'ruleLine', value })),
      ...distilled.senses.map((value): CardCollectProposalDraft => ({ kind: 'sense', value })),
      ...distilled.description.map(
        (value): CardCollectProposalDraft => ({ kind: 'descriptionLine', value }),
      ),
    ];
  }
}

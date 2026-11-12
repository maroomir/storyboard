import type { InterviewDistillDraft } from '@storyboard/story-ai';
import type {
  BibleSubjectKind,
  CardCollectProposalDraft,
  InterviewQuestion,
} from '@storyboard/story-model';

import type { InterviewSessionRequest } from '#engine/application/interviews/questionStrategy';
import {
  ReactionInterviewStrategy,
  type InterviewContext,
} from '#engine/application/interviews/reactionInterviewStrategy';

export class CharacterInterviewStrategy extends ReactionInterviewStrategy {
  protected readonly cardKind: BibleSubjectKind = 'character';

  protected override async askPreludeQuestion(
    request: InterviewSessionRequest,
    context: InterviewContext,
  ): Promise<InterviewQuestion | undefined> {
    const relationTarget: string | undefined = this.pickRelationTarget(context);
    return relationTarget === undefined
      ? undefined
      : await this.askRelationSpeech(request, context, relationTarget);
  }

  protected proposalDraftsFrom(distilled: InterviewDistillDraft): CardCollectProposalDraft[] {
    return [
      ...distilled.traits.map((value): CardCollectProposalDraft => ({ kind: 'trait', value })),
      ...distilled.voice.map((value): CardCollectProposalDraft => ({ kind: 'voiceLine', value })),
      ...distilled.desire.map((value): CardCollectProposalDraft => ({ kind: 'desireLine', value })),
      ...distilled.description.map(
        (value): CardCollectProposalDraft => ({ kind: 'descriptionLine', value }),
      ),
      ...distilled.relationSpeech.map(
        (entry): CardCollectProposalDraft => ({
          kind: 'relationSpeech',
          target: entry.target,
          speech: entry.speech,
        }),
      ),
    ];
  }
}

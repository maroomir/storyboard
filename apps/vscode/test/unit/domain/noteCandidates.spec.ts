import { describe, expect, it } from 'vitest';

import {
  cardCollectProposalId,
  mergeNoteCandidateSources,
  type CardCollectProposal,
  type CardCollectProposalDraft,
  type MergedNoteCardCandidate,
  type NoteCandidateSource,
} from '@storyboard/story-model';

function change(draft: CardCollectProposalDraft): CardCollectProposal {
  return { ...draft, id: cardCollectProposalId(draft), sourceScenes: [] } as CardCollectProposal;
}

function sourceWith(id: string, location: string, changes: CardCollectProposal[]): NoteCandidateSource {
  return {
    id,
    location,
    absorbedAt: '2026-11-02T00:00:00.000Z',
    candidates: [{ cardId: 'hana', cardType: 'character', name: '하나', sourceNotes: [], changes }],
  };
}

describe('mergeNoteCandidateSources with relation speech', () => {
  it('merges the same speech from two locations and holds different speeches as a conflict', () => {
    const same: MergedNoteCardCandidate[] = mergeNoteCandidateSources([
      sourceWith('s1', 'interview:hana:a', [change({ kind: 'relationSpeech', target: 'jun', speech: '존댓말' })]),
      sourceWith('s2', 'interview:hana:b', [change({ kind: 'relationSpeech', target: 'jun', speech: '존댓말' })]),
    ]);
    const differing: MergedNoteCardCandidate[] = mergeNoteCandidateSources([
      sourceWith('s1', 'interview:hana:a', [change({ kind: 'relationSpeech', target: 'jun', speech: '존댓말' })]),
      sourceWith('s2', 'interview:hana:b', [change({ kind: 'relationSpeech', target: 'jun', speech: '반말' })]),
    ]);

    expect(same[0]?.changes).toHaveLength(1);
    expect(same[0]?.conflicts).toEqual([]);
    expect(differing[0]?.changes).toEqual([]);
    expect(differing[0]?.conflicts[0]?.options.map((option) => option.value)).toEqual(['존댓말', '반말']);
  });
});

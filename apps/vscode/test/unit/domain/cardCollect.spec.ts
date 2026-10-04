import { describe, expect, it } from 'vitest';

import {
  applyCardCollectProposals,
  shouldProposeCardCollect,
  cardCollectProposalId,
  type CardCollectProposal,
  type CardCollectProposalDraft,
} from '@storyboard/story-model';
import type { CharacterCard, LocationBackgroundCard } from '@storyboard/story-model';

function proposal(
  draft: CardCollectProposalDraft,
  sourceScenes: string[] = ['01-scene'],
): CardCollectProposal {
  return { ...draft, id: cardCollectProposalId(draft), sourceScenes } as CardCollectProposal;
}

const elia: CharacterCard = {
  type: 'character',
  id: 'elia',
  name: '엘리아',
  attributes: { age: '17' },
  traits: ['용감함'],
  relations: [{ target: 'jihun', type: 'friend' }],
};

const library: LocationBackgroundCard = {
  type: 'location',
  id: 'library',
  name: '도서관',
  description: ['오래된 도서관'],
  characterIds: [],
  tags: [],
  weather: '비',
  locationKind: 'place',
};

describe('applyCardCollectProposals (character)', () => {
  it('updates existing keyed values in place and appends new list items', () => {
    const result = applyCardCollectProposals(elia, [
      proposal({ kind: 'attribute', key: 'age', value: '99' }),
      proposal({ kind: 'attribute', key: 'height', value: '170' }),
      proposal({ kind: 'trait', value: '용감함' }),
      proposal({ kind: 'trait', value: '신중함' }),
      proposal({ kind: 'alias', value: '별칭 엘리아' }),
      proposal({ kind: 'tag', value: '기억' }),
      proposal({ kind: 'relation', target: 'jihun', type: '소꿉친구' }),
      proposal({ kind: 'relation', target: 'mina', type: 'rival' }),
      proposal({ kind: 'arc', summary: '각성', sceneRef: '03-scene' }),
      proposal({ kind: 'recentDialogue', value: '안녕' }),
      proposal({ kind: 'descriptionLine', value: '주인공' }),
      proposal({ kind: 'voiceLine', value: '또박또박한 존댓말' }),
      proposal({ kind: 'desireLine', value: '진실을 밝히고 싶다' }),
    ]) as CharacterCard;

    expect(result.attributes).toEqual({ age: '99', height: '170' });
    expect(result.traits).toEqual(['용감함', '신중함']);
    expect(result.aliases).toEqual(['별칭 엘리아']);
    expect(result.tags).toEqual(['기억']);
    expect(result.relations).toEqual([
      { target: 'jihun', type: '소꿉친구' },
      { target: 'mina', type: 'rival' },
    ]);
    expect(result.arc).toEqual([{ stage: '03-scene', summary: '각성', sceneRef: '03-scene' }]);
    expect(result.recentDialogues).toEqual(['안녕']);
    expect(result.description).toEqual(['주인공']);
    expect(result.voice).toEqual(['또박또박한 존댓말']);
    expect(result.desire).toEqual(['진실을 밝히고 싶다']);
  });

  it('replaces an existing relation type for the same target instead of duplicating', () => {
    const result = applyCardCollectProposals(elia, [
      proposal({ kind: 'relation', target: 'jihun', type: '소꿉친구' }),
    ]) as CharacterCard;

    expect(result.relations).toEqual([{ target: 'jihun', type: '소꿉친구' }]);
  });
});

describe('applyCardCollectProposals (background)', () => {
  it('adds list items and only fills empty scalar fields', () => {
    const result = applyCardCollectProposals(library, [
      proposal({ kind: 'descriptionLine', value: '오래된 도서관' }),
      proposal({ kind: 'descriptionLine', value: '먼지 쌓인 책장' }),
      proposal({ kind: 'sense', value: '곰팡이 냄새' }),
      proposal({ kind: 'scalar', field: 'time', after: '한밤중' }),
      proposal({ kind: 'scalar', field: 'weather', after: '맑음', before: '비' }),
      proposal({ kind: 'characterId', value: 'elia' }),
      proposal({ kind: 'alias', value: '구도서관' }),
      proposal({ kind: 'tag', value: '비밀' }),
    ]) as LocationBackgroundCard;

    expect(result.description).toEqual(['오래된 도서관', '먼지 쌓인 책장']);
    expect(result.senses).toEqual(['곰팡이 냄새']);
    expect(result.time).toBe('한밤중');
    expect(result.weather).toBe('맑음');
    expect(result.characterIds).toEqual(['elia']);
    expect(result.aliases).toEqual(['구도서관']);
    expect(result.tags).toEqual(['비밀']);
  });
});

describe('shouldProposeCardCollect', () => {
  it('treats a list item that differs only in spacing or punctuation as already there', () => {
    expect(shouldProposeCardCollect(elia, proposal({ kind: 'trait', value: ' 용감함.' }))).toBe(
      false,
    );
    expect(
      shouldProposeCardCollect(
        library,
        proposal({ kind: 'descriptionLine', value: '오래된  도서관!' }),
      ),
    ).toBe(false);
    expect(
      shouldProposeCardCollect(elia, proposal({ kind: 'trait', value: '용감하지 않음' })),
    ).toBe(true);
    expect(
      applyCardCollectProposals(elia, [proposal({ kind: 'trait', value: '용감함!' })]),
    ).toMatchObject({ traits: ['용감함'] });
  });

  it('proposes new keys and changed values but not unchanged ones', () => {
    expect(
      shouldProposeCardCollect(elia, proposal({ kind: 'attribute', key: 'age', value: '17' })),
    ).toBe(false);
    expect(
      shouldProposeCardCollect(elia, proposal({ kind: 'attribute', key: 'age', value: '18' })),
    ).toBe(true);
    expect(
      shouldProposeCardCollect(elia, proposal({ kind: 'attribute', key: 'height', value: '170' })),
    ).toBe(true);
    expect(
      shouldProposeCardCollect(
        elia,
        proposal({ kind: 'relation', target: 'jihun', type: 'friend' }),
      ),
    ).toBe(false);
    expect(
      shouldProposeCardCollect(
        elia,
        proposal({ kind: 'relation', target: 'jihun', type: '소꿉친구' }),
      ),
    ).toBe(true);
    expect(
      shouldProposeCardCollect(
        library,
        proposal({ kind: 'scalar', field: 'weather', after: '비' }),
      ),
    ).toBe(false);
    expect(
      shouldProposeCardCollect(
        library,
        proposal({ kind: 'scalar', field: 'weather', after: '맑음' }),
      ),
    ).toBe(true);
    expect(
      shouldProposeCardCollect(library, proposal({ kind: 'scalar', field: 'time', after: '아침' })),
    ).toBe(true);
    expect(shouldProposeCardCollect(elia, proposal({ kind: 'alias', value: '별칭 엘리아' }))).toBe(
      true,
    );
    expect(shouldProposeCardCollect(library, proposal({ kind: 'tag', value: '비밀' }))).toBe(true);
  });
});

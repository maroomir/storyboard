import { describe, expect, it } from 'vitest';

import {
  chooseUpcomingScenes,
  collectBeatSituations,
  describeBeatSituation,
  isAxisDecided,
  listOpenAxes,
  unseenValueIds,
} from '@storyboard/story-engine';
import type {
  CharacterCard,
  InterviewAxis,
  LocationBackgroundCard,
  SceneFile,
  SceneListItem,
} from '@storyboard/story-model';

const hana: CharacterCard = { type: 'character', id: 'hana', name: '하나', aliases: ['등대 아이'] };
const tavern: LocationBackgroundCard = {
  type: 'location',
  id: 'tavern',
  name: '미감',
  aliases: ['술집'],
  description: [],
  characterIds: [],
  tags: [],
  locationKind: 'place',
};

function scene(stem: string, card: Partial<SceneFile['card']>): SceneFile {
  return {
    stem,
    order: Number(stem.slice(0, 2)),
    orderText: stem.slice(0, 2),
    slug: stem.slice(3),
    card: { type: 'scene', id: stem, ...card },
    frontmatter: {},
    body: '',
  };
}

const night: SceneFile = scene('01-night', {
  characters: ['hana', 'jun'],
  location: 'tavern',
  beats: [
    { text: '준이 하나를 심문한다', cast: ['하나', '준'], place: '미감', time: '밤' },
    { text: '하나가 자리를 뜨려 한다', cast: ['등대 아이'], place: '술집' },
    { text: '준이 혼자 남는다', cast: ['준'] },
    '모두가 흩어진다',
  ],
});

describe('collectBeatSituations', () => {
  it('matches a character by name or alias in the cast and falls back to the scene cast for bare beats', () => {
    const situations = collectBeatSituations(hana, [night]);

    expect(situations.map((situation) => situation.beatIndex)).toEqual([0, 1, 3]);
    expect(situations[0]).toMatchObject({ sceneStem: '01-night', place: '미감', time: '밤' });
  });

  it('matches a background by the beat place or alias and by the scene location for bare beats', () => {
    const situations = collectBeatSituations(tavern, [night]);

    expect(situations.map((situation) => situation.beatIndex)).toEqual([0, 1, 3]);
  });

  it('describes a situation with its coordinates', () => {
    const [first] = collectBeatSituations(hana, [night]);

    expect(describeBeatSituation(first!)).toBe('01-night: 준이 하나를 심문한다 (출연: 하나, 준 / 장소: 미감 / 시각: 밤)');
  });
});

describe('chooseUpcomingScenes', () => {
  const items: SceneListItem[] = [
    { stem: '03-c', order: 3, slug: 'c', sceneUri: '', status: 'missing', sceneMtime: 0 },
    { stem: '01-a', order: 1, slug: 'a', sceneUri: '', status: 'ready', sceneMtime: 0 },
    { stem: '02-b', order: 2, slug: 'b', sceneUri: '', status: 'stale', sceneMtime: 0 },
  ];

  it('prefers undrafted scenes in order, limited, unless stems are requested', () => {
    expect(chooseUpcomingScenes(items, 1, undefined).map((item) => item.stem)).toEqual(['02-b']);
    expect(chooseUpcomingScenes(items, 5, undefined).map((item) => item.stem)).toEqual(['02-b', '03-c']);
    expect(chooseUpcomingScenes(items, 5, ['01-a']).map((item) => item.stem)).toEqual(['01-a']);
  });

  it('falls back to every scene when all are drafted', () => {
    const drafted: SceneListItem[] = items.map((item) => ({ ...item, status: 'ready' }));

    expect(chooseUpcomingScenes(drafted, 2, undefined).map((item) => item.stem)).toEqual(['01-a', '02-b']);
  });
});

describe('axis bookkeeping', () => {
  const axis: InterviewAxis = {
    id: 'pressure',
    label: '압박 아래',
    values: [
      { id: 'counter', label: '역공' },
      { id: 'withhold', label: '침묵' },
    ],
  };

  it('decides an axis once one value reaches the minimum weight', () => {
    expect(isAxisDecided({ pressure: { withhold: 1 } }, 'pressure', 2)).toBe(false);
    expect(isAxisDecided({ pressure: { withhold: 2 } }, 'pressure', 2)).toBe(true);
    expect(isAxisDecided({}, 'pressure', 2)).toBe(false);
  });

  it('lists unseen values and open axes', () => {
    expect(unseenValueIds({ pressure: { withhold: 1 } }, axis)).toEqual(['counter']);
    expect(listOpenAxes([axis], { pressure: { withhold: 2 } }, 2, []).map((open) => open.axisId)).toEqual([]);
    expect(listOpenAxes([axis], {}, 2, []).map((open) => open.axisLabel)).toEqual(['압박 아래']);
  });
});

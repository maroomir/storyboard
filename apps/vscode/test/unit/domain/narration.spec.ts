import { describe, expect, it } from 'vitest';

import {
  NarrationError,
  parseNarratorCard,
  parseScene,
  resolveNarration,
  type NarratorCard,
} from '@storyboard/story-model';

const narratorFixture: string = "type: narrator\nid: hana-first\nname: 하나의 목소리\nperson: first\nknowledge: witnessed\ntense: past\nfocal: hana\nvoice:\n  - 건조한 단문\n  - 자기 비하 섞인 유머\n";
const narratedSceneFixture: string = "type: scene\nid: 03-narrated\ntitle: 등불\ncharacters:\n  - hana\nlocation: night-market\nnarrator: hana-first\nthread: ep2\nsummary: 하나가 등불 아래에서 준을 기다린다.\n";

const hanaFirst: NarratorCard = {
  type: 'narrator',
  id: 'hana-first',
  name: '하나의 목소리',
  person: 'first',
  knowledge: 'witnessed',
  tense: 'past',
  focal: 'hana',
  voice: ['건조한 단문'],
};

const junOmniscient: NarratorCard = {
  type: 'narrator',
  id: 'jun-third',
  name: '준의 장',
  person: 'third',
  knowledge: 'omniscient',
};

const narrators = new Map([
  [hanaFirst.id, hanaFirst],
  [junOmniscient.id, junOmniscient],
]);

describe('narrator card codec', () => {
  it('reads the narrator fixture', () => {
    const rawCard = narratorFixture;

    expect(parseNarratorCard(rawCard)).toMatchObject({ type: 'narrator' });
  });

  it('reads narrator and thread from a scene card', () => {
    const rawScene = narratedSceneFixture;

    const scene = parseScene(rawScene, '03-narrated.card');

    expect(scene.card.narrator).toBe('hana-first');
    expect(scene.card.thread).toBe('ep2');
    expect(scene.frontmatter.narrator).toBe('hana-first');
  });
});

describe('resolveNarration', () => {
  it('returns nothing when the project sets no point of view', () => {
    expect(resolveNarration({})).toBeUndefined();
  });

  it('derives an implicit narrator from each point of view', () => {
    expect(resolveNarration({ pov: 'first' })).toMatchObject({
      person: 'first',
      knowledge: 'witnessed',
      tense: 'past',
    });
    expect(resolveNarration({ pov: 'first-retrospective' })).toMatchObject({
      person: 'first',
      knowledge: 'retrospective',
    });
    expect(resolveNarration({ pov: 'second' })).toMatchObject({
      person: 'second',
      knowledge: 'witnessed',
    });
    expect(resolveNarration({ pov: 'third-limited' })).toMatchObject({
      person: 'third',
      knowledge: 'witnessed',
    });
    expect(resolveNarration({ pov: 'third-omniscient' })).toMatchObject({
      person: 'third',
      knowledge: 'omniscient',
    });
  });

  it('prefers the scene narrator over the chapter and project defaults', () => {
    const directive = resolveNarration({
      sceneNarrator: 'hana-first',
      chapterNarrator: 'jun-third',
      defaultNarrator: 'jun-third',
      pov: 'third-omniscient',
      narrators,
    });

    expect(directive).toMatchObject({ narratorId: 'hana-first', person: 'first', focal: 'hana' });
  });

  it('falls back to the chapter narrator when the scene names none', () => {
    const directive = resolveNarration({
      chapterNarrator: 'jun-third',
      defaultNarrator: 'hana-first',
      narrators,
    });

    expect(directive).toMatchObject({ narratorId: 'jun-third', knowledge: 'omniscient' });
  });

  it('defaults a narrator card without a tense to past tense', () => {
    const directive = resolveNarration({ sceneNarrator: 'jun-third', narrators });

    expect(directive?.tense).toBe('past');
  });

  it('refuses a narrator reference that has no card', () => {
    expect(() => resolveNarration({ sceneNarrator: 'missing', narrators })).toThrow(NarrationError);

    try {
      resolveNarration({ sceneNarrator: 'missing', narrators });
    } catch (error) {
      expect((error as NarrationError).code).toBe('unknown-narrator');
    }
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NarrationError,
  parseNarratorCard,
  parseScene,
  resolveNarration,
  serializeNarratorCard,
  type NarratorCard,
} from '@storyboard/story-model';

const cardsFixtureDirectory = fileURLToPath(
  new URL('../../../../../packages/story-model/test/fixtures/cards/', import.meta.url),
);
const scenesFixtureDirectory = fileURLToPath(
  new URL('../../../../../packages/story-model/test/fixtures/scenes/', import.meta.url),
);

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
  it('round-trips the narrator fixture without changing stable YAML output', () => {
    const rawCard = readFileSync(join(cardsFixtureDirectory, 'narrator.card'), 'utf8');

    expect(serializeNarratorCard(parseNarratorCard(rawCard))).toBe(rawCard);
  });

  it('reads narrator and thread from a scene card', () => {
    const rawScene = readFileSync(join(scenesFixtureDirectory, '03-narrated.card'), 'utf8');

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

  it('keeps the scene focal character when only a focal is known', () => {
    expect(resolveNarration({ focalFallback: 'hana' })).toEqual({ focal: 'hana' });
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

  it('uses the scene focal when the narrator card names none', () => {
    const directive = resolveNarration({
      sceneNarrator: 'jun-third',
      focalFallback: 'jun',
      narrators,
    });

    expect(directive).toMatchObject({ focal: 'jun' });
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

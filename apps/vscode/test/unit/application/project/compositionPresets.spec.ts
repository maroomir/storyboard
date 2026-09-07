import { describe, expect, it } from 'vitest';

import { buildCompositionPreset, validateGenerationContract } from '@storyboard/story-engine';
import type { ProjectSetting } from '@storyboard/story-format';

function settingWith(preset: ReturnType<typeof buildCompositionPreset>): ProjectSetting {
  return {
    genre: '성장 판타지',
    audience: '10대 후반',
    pov: 'third-limited',
    targetWordCount: 120_000,
    tags: [],
    prohibitions: [],
    styleConstraints: [],
    qualityCriteria: [],
    ...preset.setting,
  };
}

describe('buildCompositionPreset', () => {
  it('leaves a linear project without threads or narrator cards', () => {
    const preset = buildCompositionPreset({ composition: 'linear' });

    expect(preset.setting).toEqual({ composition: 'linear' });
    expect(preset.narratorCards).toEqual([]);
  });

  it('creates one thread per omnibus episode', () => {
    const preset = buildCompositionPreset({ composition: 'omnibus', episodeCount: 3 });

    expect(Object.keys(preset.setting.threads ?? {})).toEqual(['ep1', 'ep2', 'ep3']);
  });

  it('refuses to build a one-episode omnibus, which is not an omnibus', () => {
    const preset = buildCompositionPreset({ composition: 'omnibus', episodeCount: 1 });

    expect(Object.keys(preset.setting.threads ?? {})).toHaveLength(2);
  });

  it('creates a narrator card per point-of-view character for alternating chapters', () => {
    const preset = buildCompositionPreset({
      composition: 'alternating-pov',
      povCharacters: ['hana', 'jun'],
      pov: 'first',
    });

    expect(preset.narratorCards.map((card) => card.id)).toEqual(['hana-pov', 'jun-pov']);
    expect(preset.narratorCards[0]).toMatchObject({
      person: 'first',
      knowledge: 'witnessed',
      focal: 'hana',
    });
    expect(preset.setting.narration?.defaultNarrator).toBe('hana-pov');
  });

  it('carries a retrospective point of view into the generated narrator cards', () => {
    const preset = buildCompositionPreset({
      composition: 'alternating-pov',
      povCharacters: ['hana'],
      pov: 'first-retrospective',
    });

    expect(preset.narratorCards[0]).toMatchObject({ person: 'first', knowledge: 'retrospective' });
  });

  it('wraps the inner thread for a frame story', () => {
    const preset = buildCompositionPreset({ composition: 'frame' });

    expect(preset.setting.threads?.frame?.wraps).toEqual(['inner']);
    expect(preset.setting.threads?.inner).toBeDefined();
  });

  it('produces a contract every preset passes validation with', () => {
    for (const composition of ['linear', 'omnibus', 'alternating-pov', 'frame'] as const) {
      const preset = buildCompositionPreset({
        composition,
        povCharacters: ['hana', 'jun'],
        pov: 'third-limited',
      });

      expect(validateGenerationContract(settingWith(preset)).warnings).toEqual([]);
    }
  });
});

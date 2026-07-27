import { describe, expect, it } from 'vitest';

import {
  coerceChapterPlan,
  coerceOutlineSynopsis,
  outlineVersion,
  toOutlineBrief,
} from '@storyboard/story-format';
import type { OutlineBrief, StoryboardProject } from '@storyboard/story-format';
const brief: OutlineBrief = {
  projectName: 'MagicBoy',
  format: 'novel',
  language: 'ko',
  genre: '판타지',
  audience: '청소년',
  pov: 'third-limited',
  targetWordCount: 80_000,
  tags: [],
  prohibitions: [],
};

describe('toOutlineBrief', () => {
  it('derives a brief from the project setting', () => {
    const project: StoryboardProject = {
      version: '1.0.0',
      id: 'id-1',
      name: 'MagicBoy',
      format: 'novel',
      language: 'ko',
      createdAt: '2026-06-17T00:00:00.000Z',
      editor: { scenePrefixDigits: 2 },
      setting: {
        genre: '판타지',
        tags: ['학원'],
        audience: '청소년',
        pov: 'first',
        targetWordCount: 50_000,
        prohibitions: ['폭력'],
      },
    };

    expect(toOutlineBrief(project)).toMatchObject({
      projectName: 'MagicBoy',
      genre: '판타지',
      audience: '청소년',
      pov: 'first',
      targetWordCount: 50_000,
      tags: ['학원'],
      prohibitions: ['폭력'],
    });
  });

  it('falls back to empty lists when setting is missing', () => {
    const project: StoryboardProject = {
      version: '1.0.0',
      id: 'id-2',
      name: 'Untitled',
      format: 'novel',
      language: 'ko',
      createdAt: '2026-06-17T00:00:00.000Z',
      editor: { scenePrefixDigits: 2 },
    };

    expect(toOutlineBrief(project)).toMatchObject({ tags: [], prohibitions: [], genre: undefined });
  });
});

describe('coerceOutlineSynopsis', () => {
  it('keeps provided fields', () => {
    const synopsis = coerceOutlineSynopsis(
      {
        logline: '소년이 마법을 배운다.',
        genrePromise: '성장 판타지',
        mainConflicts: ['스승과의 갈등'],
        ending: '각성',
        theme: '용기',
        tone: '따뜻함',
        pov: 'first',
        styleRules: ['짧은 문장'],
      },
      brief,
    );

    expect(synopsis.logline).toBe('소년이 마법을 배운다.');
    expect(synopsis.mainConflicts).toEqual(['스승과의 갈등']);
    expect(synopsis.pov).toBe('first');
  });

  it('fills defaults and falls back pov to the brief', () => {
    const synopsis = coerceOutlineSynopsis({ logline: '한 문장' }, brief);

    expect(synopsis.logline).toBe('한 문장');
    expect(synopsis.genrePromise).toBe('');
    expect(synopsis.styleRules).toEqual([]);
    expect(synopsis.pov).toBe(brief.pov);
  });

  it('returns defaults for non-object input', () => {
    const synopsis = coerceOutlineSynopsis('not-json', brief);

    expect(synopsis.logline).toBe('');
    expect(synopsis.mainConflicts).toEqual([]);
    expect(synopsis.pov).toBe(brief.pov);
  });
});

describe('coerceChapterPlan', () => {
  it('preserves a well-formed plan', () => {
    const plan = coerceChapterPlan({
      acts: [
        {
          id: 'act-intro',
          title: '발단',
          chapters: [
            {
              id: 'ch-1',
              title: '1장',
              scenes: [
                {
                  id: '01-arrival',
                  title: '도착',
                  purpose: '주인공 소개',
                  characters: ['elia', 'jihoon'],
                  location: 'school',
                  emotionalShift: '불안 → 설렘',
                  foreshadowing: ['전학 이유'],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(plan.version).toBe(outlineVersion);
    expect(plan.acts[0]?.chapters[0]?.scenes[0]).toMatchObject({
      id: '01-arrival',
      characters: ['elia', 'jihoon'],
      location: 'school',
      foreshadowing: ['전학 이유'],
    });
  });

  it('fills fallback ids and titles when missing', () => {
    const plan = coerceChapterPlan({ acts: [{ chapters: [{ scenes: [{}] }] }] });

    expect(plan.acts[0]?.id).toBe('act-1');
    expect(plan.acts[0]?.chapters[0]?.id).toBe('chapter-1-1');
    expect(plan.acts[0]?.chapters[0]?.scenes[0]?.id).toBe('scene-1-1-1');
    expect(plan.acts[0]?.chapters[0]?.scenes[0]?.purpose).toBe('');
    expect(plan.acts[0]?.chapters[0]?.scenes[0]?.characters).toEqual([]);
  });

  it('accepts a top-level array of acts and drops non-string list items', () => {
    const plan = coerceChapterPlan([
      {
        id: 'a1',
        title: '막',
        chapters: [
          {
            id: 'c1',
            title: '장',
            scenes: [{ id: 's1', title: '씬', characters: ['elia', 7, ''] }],
          },
        ],
      },
    ]);

    expect(plan.acts).toHaveLength(1);
    expect(plan.acts[0]?.chapters[0]?.scenes[0]?.characters).toEqual(['elia']);
  });

  it('returns an empty plan for non-plan input', () => {
    expect(coerceChapterPlan('nope').acts).toEqual([]);
  });
});

describe('coerceOutlineSynopsis field-level salvage', () => {
  it('keeps valid fields when one list entry is malformed', () => {
    const brief = {
      projectName: 'p',
      format: 'novel',
      language: 'ko',
      tags: [],
      prohibitions: [],
      styleConstraints: [],
      qualityCriteria: [],
    } as never;
    const raw = {
      logline: '살아남은 로그라인',
      genrePromise: '약속',
      mainConflicts: ['   '],
      ending: '결말',
      theme: '주제',
      tone: '톤',
      styleRules: [],
    };

    const coerced = coerceOutlineSynopsis(raw, brief);

    expect(coerced.logline).toBe('살아남은 로그라인');
    expect(coerced.ending).toBe('결말');
    expect(coerced.mainConflicts).toEqual([]);
  });
});

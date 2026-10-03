import { describe, expect, it } from 'vitest';

import { cardSchema, isCardType } from '@storyboard/story-model';

describe('card schema', () => {
  it('parses a minimal character card', () => {
    const parsedCard = cardSchema.parse({ type: 'character', id: 'elia', name: '엘리아' });

    expect(parsedCard.type).toBe('character');
  });

  it('parses a minimal location background card', () => {
    const parsedCard = cardSchema.parse({ type: 'location', id: 'school', name: '학교' });

    expect(parsedCard.type).toBe('location');
  });

  it('rejects card ids that are unsafe as file names', () => {
    const parseResult = cardSchema.safeParse({ type: 'character', id: '엘리아', name: '엘리아' });

    expect(parseResult.success).toBe(false);
  });

  it('narrows supported card types', () => {
    expect(isCardType('character')).toBe(true);
    expect(isCardType('scene')).toBe(false);
  });

  it('preserves valid character roles', () => {
    for (const role of ['main', 'supporting', 'extra'] as const) {
      const parsedCard = cardSchema.parse({ type: 'character', id: 'elia', name: '엘리아', role });

      expect(parsedCard.type).toBe('character');
      if (parsedCard.type === 'character') {
        expect(parsedCard.role).toBe(role);
      }
    }
  });

  it('rejects unknown character role values (decision #29)', () => {
    const result = cardSchema.safeParse({
      type: 'character',
      id: 'hero',
      name: '주인공',
      role: 'villain',
    });

    expect(result.success).toBe(false);
  });

  it('parses list-form voice and description on a character card', () => {
    const parsedCard = cardSchema.parse({
      type: 'character',
      id: 'elia',
      name: '엘리아',
      voice: ['느린 말투로 말한다', '어조에 농담을 섞는다'],
      description: ['주인공', '17세 여학생'],
    });

    expect(parsedCard.type).toBe('character');
    if (parsedCard.type === 'character') {
      expect(parsedCard.voice).toEqual(['느린 말투로 말한다', '어조에 농담을 섞는다']);
      expect(parsedCard.description).toEqual(['주인공', '17세 여학생']);
    }
  });

  it('rejects string-form voice and description on a character card', () => {
    const parseResult = cardSchema.safeParse({
      type: 'character',
      id: 'elia',
      name: '엘리아',
      voice: '느린 말투로 말한다',
    });

    expect(parseResult.success).toBe(false);
  });

  it('defaults background description to an empty list', () => {
    const parsedCard = cardSchema.parse({ type: 'location', id: 'school', name: '학교' });

    if (parsedCard.type === 'location') {
      expect(parsedCard.description).toEqual([]);
    }
  });

  it('parses aliases on a background card', () => {
    const parsedCard = cardSchema.parse({
      type: 'location',
      id: 'school',
      name: '학교 정문',
      aliases: ['학교', '교문'],
    });

    if (parsedCard.type === 'location') {
      expect(parsedCard.aliases).toEqual(['학교', '교문']);
    }
  });

  it('parses a desire list on a character card', () => {
    const parsedCard = cardSchema.parse({
      type: 'character',
      id: 'elia',
      name: '엘리아',
      desire: ['진짜 친구를 만들고 싶다'],
    });

    if (parsedCard.type === 'character') {
      expect(parsedCard.desire).toEqual(['진짜 친구를 만들고 싶다']);
    }
  });

  it('parses time, weather, and senses on a background card', () => {
    const parsedCard = cardSchema.parse({
      type: 'location',
      id: 'school',
      name: '학교 정문',
      time: '아침',
      weather: '맑음',
      senses: ['종소리', '잔디 냄새'],
    });

    if (parsedCard.type === 'location') {
      expect(parsedCard.time).toBe('아침');
      expect(parsedCard.weather).toBe('맑음');
      expect(parsedCard.senses).toEqual(['종소리', '잔디 냄새']);
    }
  });
});

import { describe, expect, it } from 'vitest';

import {
  CardParseError,
  parseCard,
  serializeCard,
} from '@storyboard/story-model';
import type { StoryboardCard } from '@storyboard/story-model';
const cardFixtures: Readonly<Record<string, string>> = {
  'character.card': "type: character\nid: elia\nname: 엘리아\nprofile: profile/elia.png\nrole: main\nattributes:\n  age: 17\n  sex: female\n  mbti: ENFJ\ntraits:\n  - 활발하게 움직임\n  - 결단력 있는 발언\ndescription:\n  - 주인공. 학교에 첫 등교한 17세 여학생.\n  - 새로운 학교 생활에 대한 기대와 긴장을 함께 품고 있다.\ndesire:\n  - 새 학교에서 진짜 친구를 만들고 싶다\nrelations:\n  - target: jihoon\n    type: 친구\narc: 학교에 도착해 새 친구를 만남\n",
  'background.card': "type: location\nid: school\nname: 학교 정문\naliases:\n  - 학교\n  - 교문\n  - 정문\ndescription:\n  - 주인공이 처음 등교하는 고등학교 정문.\n  - 아침 햇빛과 등교하는 학생들로 붐빈다.\ncharacterIds: []\ntags:\n  - 학교\n  - 도시\ntime: 아침\nweather: 맑음\nsenses:\n  - 멀리서 울리는 등교 종소리\n  - 갓 자른 잔디 냄새\nlayout:\n  - 정문은 큰길 쪽 하나뿐이고, 왼쪽 담을 따라 가면 쪽문이 있다\n  - 정문 안쪽 경비실 창으로 운동장까지 보인다\nrules:\n  - 8시 30분이 지나면 정문을 닫고 쪽문으로만 들어온다\n",
};

describe('card file codec', () => {
  it.each(['character.card', 'background.card'])(
    'round-trips %s without changing stable YAML output',
    (fixtureName) => {
      const rawCard = readFixtureCard(fixtureName);

      const parsedCard = parseCard(rawCard);
      const serializedCard = serializeCard(parsedCard);

      expect(serializedCard).toBe(rawCard);
    },
  );

  it('wraps invalid YAML as a card parse error', () => {
    expect(() => parseCard('type: character\nid: [')).toThrow(CardParseError);

    try {
      parseCard('type: character\nid: [');
    } catch (error) {
      expect(error).toBeInstanceOf(CardParseError);
      expect((error as CardParseError).code).toBe('invalid-yaml');
    }
  });

  it('wraps schema violations as a card parse error', () => {
    expect(() => parseCard('type: character\nid: 엘리아\nname: 엘리아\n')).toThrow(CardParseError);

    try {
      parseCard('type: character\nid: 엘리아\nname: 엘리아\n');
    } catch (error) {
      expect(error).toBeInstanceOf(CardParseError);
      expect((error as CardParseError).code).toBe('invalid-card-schema');
    }
  });

  it('rejects unknown character role values on parse (decision #29)', () => {
    expect(() =>
      parseCard(['type: character', 'id: x', 'name: 엑스', 'role: villain'].join('\n')),
    ).toThrow(CardParseError);
  });

  it('round-trips character aliases through serialize and parse', () => {
    const card: StoryboardCard = {
      type: 'character',
      id: 'manjae',
      name: '조만재',
      role: 'main',
      aliases: ['만재', '재'],
    };

    const reparsed = parseCard(serializeCard(card));

    expect(reparsed.type).toBe('character');
    if (reparsed.type === 'character') {
      expect(reparsed.aliases).toEqual(['만재', '재']);
    }
  });

  it('keeps the top-level key order of the card text it rewrites', () => {
    const handWritten: string = [
      'type: character',
      'id: manjae',
      'name: 조만재',
      'catchphrases:',
      '  - 엘리트',
      'role: main',
      'traits:',
      '  - 허세',
      '',
    ].join('\n');
    const card: StoryboardCard = { ...parseCard(handWritten), aliases: ['만재'] } as StoryboardCard;

    const rewritten: string = serializeCard(card, { keyOrderOf: handWritten });

    expect(rewritten.split('\n').filter((line) => /^[a-z]/.test(line))).toEqual([
      'type: character',
      'id: manjae',
      'name: 조만재',
      'catchphrases:',
      'role: main',
      'traits:',
      'aliases:',
    ]);
    expect(serializeCard(card)).toBe(serializeCard(parseCard(rewritten)));
  });

  it('round-trips background aliases through serialize and parse', () => {
    const card: StoryboardCard = {
      type: 'location',
      id: 'school',
      name: '학교 정문',
      aliases: ['학교', '교문'],
      description: [],
      characterIds: [],
      tags: [],
    };

    const reparsed = parseCard(serializeCard(card));

    expect(reparsed.type).toBe('location');
    if (reparsed.type === 'location') {
      expect(reparsed.aliases).toEqual(['학교', '교문']);
    }
  });

  it('round-trips a character desire field through serialize and parse', () => {
    const card: StoryboardCard = {
      type: 'character',
      id: 'manjae',
      name: '조만재',
      role: 'main',
      desire: ['라이벌을 이기고 싶다', '인정받고 싶다'],
    };

    const reparsed = parseCard(serializeCard(card));

    expect(reparsed.type).toBe('character');
    if (reparsed.type === 'character') {
      expect(reparsed.desire).toEqual(['라이벌을 이기고 싶다', '인정받고 싶다']);
    }
  });

  it('round-trips background time, weather, and senses through serialize and parse', () => {
    const card: StoryboardCard = {
      type: 'location',
      id: 'school',
      name: '학교 정문',
      description: [],
      characterIds: [],
      tags: [],
      time: '아침',
      weather: '맑음',
      senses: ['종소리', '잔디 냄새'],
    };

    const reparsed = parseCard(serializeCard(card));

    expect(reparsed.type).toBe('location');
    if (reparsed.type === 'location') {
      expect(reparsed.time).toBe('아침');
      expect(reparsed.weather).toBe('맑음');
      expect(reparsed.senses).toEqual(['종소리', '잔디 냄새']);
    }
  });

  it('round-trips background layout and rules through serialize and parse', () => {
    const card: StoryboardCard = {
      type: 'location',
      id: 'tavern',
      name: '미감',
      description: [],
      characterIds: [],
      tags: [],
      layout: ['뒷문은 주방을 지나야 한다'],
      rules: ['밤에는 주인이 카운터를 떠나지 않는다'],
    };

    const reparsed = parseCard(serializeCard(card));

    expect(reparsed).toMatchObject({
      layout: ['뒷문은 주방을 지나야 한다'],
      rules: ['밤에는 주인이 카운터를 떠나지 않는다'],
    });
    expect(serializeCard(card).indexOf('layout:')).toBeGreaterThan(serializeCard(card).indexOf('tags:'));
  });

  it('preserves AI-managed fields through serialize and parse', () => {
    const card: StoryboardCard = {
      type: 'character',
      id: 'manjae',
      name: '조만재',
      role: 'main',
      attributes: { age: 18 },
      traits: ['허세 섞인 단언'],
      relations: [{ target: 'eunha', type: '라이벌' }],
      arc: '첫 등장',
    };

    const reparsed = parseCard(serializeCard(card));

    expect(reparsed.type).toBe('character');
    if (reparsed.type === 'character') {
      expect(reparsed.attributes).toEqual({ age: 18 });
      expect(reparsed.traits).toEqual(['허세 섞인 단언']);
      expect(reparsed.relations).toEqual([{ target: 'eunha', type: '라이벌' }]);
      expect(reparsed.arc).toBe('첫 등장');
    }
  });

  it('round-trips a character voice field through serialize and parse', () => {
    const card: StoryboardCard = {
      type: 'character',
      id: 'manjae',
      name: '조만재',
      role: 'main',
      description: ['허세덩어리'],
      voice: ['1인칭 허세 만연체', '자칭 세기의 철학자'],
    };

    const reparsed = parseCard(serializeCard(card));

    expect(reparsed.type).toBe('character');
    if (reparsed.type === 'character') {
      expect(reparsed.voice).toEqual(['1인칭 허세 만연체', '자칭 세기의 철학자']);
    }
  });

  it('round-trips character catchphrases between voice and desire', () => {
    const card: StoryboardCard = {
      type: 'character',
      id: 'mother',
      name: '엄마',
      role: 'support',
      voice: ['느릿한 반말'],
      catchphrases: ['뭐 별거는 아닌데'],
      desire: ['아들이 밥은 먹고 다녔으면'],
    };

    const serialized = serializeCard(card);
    const reparsed = parseCard(serialized);

    expect(serialized.indexOf('catchphrases:')).toBeGreaterThan(serialized.indexOf('voice:'));
    expect(serialized.indexOf('catchphrases:')).toBeLessThan(serialized.indexOf('desire:'));
    expect(reparsed.type).toBe('character');
    if (reparsed.type === 'character') {
      expect(reparsed.catchphrases).toEqual(['뭐 별거는 아닌데']);
    }
  });
});

function readFixtureCard(fixtureName: string): string {
  return cardFixtures[fixtureName] ?? '';
}

describe('character role policy (decision #29)', () => {
  it("maps 'support' to the supporting cast instead of demoting to extra", () => {
    const card = parseCard(
      ['type: character', 'id: junhee', 'name: 준희', 'role: support'].join('\n'),
    );

    expect(card.type === 'character' ? card.role : undefined).toBe('supporting');
  });

  it('forgives casing', () => {
    const card = parseCard(['type: character', 'id: x', 'name: 엑스', 'role: Main'].join('\n'));

    expect(card.type === 'character' ? card.role : undefined).toBe('main');
  });

  it('surfaces an unknown role as a validation error instead of demoting silently', () => {
    expect(() =>
      parseCard(['type: character', 'id: x', 'name: 엑스', 'role: 주연'].join('\n')),
    ).toThrow(/role/);
  });
});

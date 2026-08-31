import { describe, expect, it } from 'vitest';

import { mergeSituationsToSourceBlockLimit } from '@storyboard/story-pipeline';

describe('mergeSituationsToSourceBlockLimit', () => {
  it('merges the shortest adjacent situations until it matches source block count', () => {
    const situations = Array.from({ length: 9 }, (_, index) => ({
      situation: index === 0 ? '가' : `상황 ${index}`,
      characters: index % 2 === 0 ? ['가'] : ['나'],
    }));
    const source = ['첫 블록', '둘째 블록', '셋째 블록', '넷째 블록'].join('\n\n');

    const merged = mergeSituationsToSourceBlockLimit(situations, source);

    expect(merged).toHaveLength(4);
    expect(merged.flatMap((item) => item.characters)).toContain('가');
    expect(merged.flatMap((item) => item.characters)).toContain('나');
  });
});

import { describe, expect, it } from 'vitest';

import { scopeBackgroundFacts } from '@storyboard/story-engine';

describe('scopeBackgroundFacts', () => {
  const scenePlaces = ['집 거실, 발코니 앞 가림막', '형제 방', '학교 교문 앞', '옥상 발코니'];
  const facts = [
    '밤, 바람',
    '은하의 방은 따로 없다. 거실 발코니 앞에 세운 가림막 뒤가 은하의 잠자리다',
    '옥상 발코니에는 그릴과 접이식 테이블이 있다',
    '현관문은 삐걱거린다',
  ];

  it('labels a fact bound to words outside the section with those words', () => {
    expect(scopeBackgroundFacts(facts, ['옥상 발코니'], scenePlaces)).toEqual([
      '밤, 바람',
      '[다른 자리: 거실, 가림막] 은하의 방은 따로 없다. 거실 발코니 앞에 세운 가림막 뒤가 은하의 잠자리다',
      '옥상 발코니에는 그릴과 접이식 테이블이 있다',
      '현관문은 삐걱거린다',
    ]);
  });

  it('leaves a fact alone when every place word it names is in the section', () => {
    expect(scopeBackgroundFacts(facts, ['집 거실, 발코니 앞 가림막'], scenePlaces)[1]).toBe(facts[1]);
    expect(scopeBackgroundFacts(facts, ['집 거실, 발코니 앞 가림막'], scenePlaces)[2]).toBe(
      '[다른 자리: 옥상] 옥상 발코니에는 그릴과 접이식 테이블이 있다',
    );
  });

  it('changes nothing when the section or the scene has no places', () => {
    expect(scopeBackgroundFacts(facts, [], scenePlaces)).toEqual(facts);
    expect(scopeBackgroundFacts(facts, ['옥상 발코니'], [])).toEqual(facts);
  });
});

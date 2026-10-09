import { describe, expect, it } from 'vitest';

import { resolveMinimumDraftLength, validateDraftCandidate } from '@storyboard/story-engine';
import { resolveSceneTargetLength } from '@storyboard/story-model';

describe('draft candidate validation', () => {
  it('uses the configured compression limit when no scene target exists', () => {
    expect(resolveMinimumDraftLength(600, { maxCompressionPercent: 50 })).toBe(300);
    expect(resolveMinimumDraftLength(600, { maxCompressionPercent: 90 })).toBe(60);
    expect(resolveMinimumDraftLength(600, { maxCompressionPercent: 0 })).toBe(600);
  });

  it('prioritizes a scene target length over the compression limit', () => {
    expect(
      resolveMinimumDraftLength(600, { maxCompressionPercent: 50, targetLength: 400 }),
    ).toBe(360);
  });

  it('lets a draft still under its scene target shrink by a tenth at most', () => {
    expect(
      resolveMinimumDraftLength(600, { maxCompressionPercent: 50, targetLength: 1000 }),
    ).toBe(540);
  });

  it('keeps the floor continuous where a draft reaches its scene target', () => {
    const policy = { maxCompressionPercent: 50, targetLength: 40_000 };

    expect(resolveMinimumDraftLength(39_999, policy)).toBe(36_000);
    expect(resolveMinimumDraftLength(40_000, policy)).toBe(36_000);
    expect(resolveMinimumDraftLength(50_000, policy)).toBe(36_000);
  });

  it('accepts a revision slightly shorter than a draft still under its scene target', () => {
    const policy = { maxCompressionPercent: 20, targetLength: 1000 };
    const original = '가'.repeat(600);

    expect(validateDraftCandidate(original, '나'.repeat(700), policy).accepted).toBe(true);
    // #88-10: 목표 미달 원고의 감수 결과가 3% 줄었다고 통째로 기각되던 것을 막는다.
    expect(validateDraftCandidate(original, '나'.repeat(580), policy).accepted).toBe(true);
    expect(validateDraftCandidate(original, '나'.repeat(470), policy).reason).toBe('too-short');
  });

  it('reads an inline target length from an outline-derived scene seed', () => {
    expect(resolveSceneTargetLength(undefined, '[목표 분량]\n약 3,000자')).toBe(3000);
    expect(resolveSceneTargetLength(2400, '[목표 분량]\n약 3,000자')).toBe(2400);
  });

  it('rejects empty, meta, and overly short candidates', () => {
    const policy = { maxCompressionPercent: 50 };
    const original = '가'.repeat(600);

    expect(validateDraftCandidate(original, '', policy).reason).toBe('empty');
    expect(validateDraftCandidate(original, '다음과 같이 수정했습니다.', policy).reason).toBe(
      'meta-response',
    );
    expect(validateDraftCandidate(original, '나'.repeat(299), policy).reason).toBe('too-short');
  });

  it('requires a manual condensation candidate to be shorter', () => {
    const original = '가'.repeat(600);
    expect(
      validateDraftCandidate(original, '나'.repeat(600), { maxCompressionPercent: 50 }, { requireShorter: true })
        .reason,
    ).toBe('not-shorter');
  });

  it('rejects a candidate whose scene breaks were added, dropped or merged', () => {
    const policy = { maxCompressionPercent: 50 };
    const original = ['가'.repeat(200), '---', '나'.repeat(200), '---', '다'.repeat(200)].join('\n\n');
    const merged = ['가'.repeat(300), '---', '나'.repeat(300)].join('\n\n');
    const kept = ['라'.repeat(250), '---', '마'.repeat(150), '---', '바'.repeat(200)].join('\n\n');

    expect(validateDraftCandidate(original, merged, policy).reason).toBe('scene-breaks-changed');
    expect(validateDraftCandidate(original, kept, policy).accepted).toBe(true);
  });
});

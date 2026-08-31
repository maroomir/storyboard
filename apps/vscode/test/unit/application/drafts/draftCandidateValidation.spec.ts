import { describe, expect, it } from 'vitest';

import {
  resolveMinimumDraftLength,
  resolveSceneTargetLength,
  validateDraftCandidate,
} from '@storyboard/story-pipeline';

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

  it('never raises the minimum above the original length of a short draft', () => {
    expect(
      resolveMinimumDraftLength(600, { maxCompressionPercent: 20, targetLength: 1000 }),
    ).toBe(600);
  });

  it('accepts a revision that lengthens a draft still under its scene target', () => {
    const policy = { maxCompressionPercent: 20, targetLength: 1000 };
    const original = '가'.repeat(600);

    expect(validateDraftCandidate(original, '나'.repeat(700), policy).accepted).toBe(true);
    expect(validateDraftCandidate(original, '나'.repeat(500), policy).reason).toBe('too-short');
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
});

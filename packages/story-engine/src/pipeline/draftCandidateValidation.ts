import { clampIntegerSetting, integerSettingDefault } from '@storyboard/story-model';

export { resolveSceneTargetLength } from '@storyboard/story-model';

export type DraftCandidateRejectionReason =
  | 'empty'
  | 'meta-response'
  | 'too-short'
  | 'not-shorter'
  | 'scene-breaks-changed';

export interface DraftCandidateLengthPolicy {
  readonly maxCompressionPercent: number;
  readonly targetLength?: number;
}

export interface DraftCandidateValidation {
  readonly accepted: boolean;
  readonly candidateLength: number;
  readonly minimumLength: number;
  readonly reason?: DraftCandidateRejectionReason;
}

const maxCompressionPercentKey: string = 'revise.length.maxCompressionPercent';

export function normalizeMaxCompressionPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return integerSettingDefault(maxCompressionPercentKey);
  }

  return clampIntegerSetting(maxCompressionPercentKey, Math.floor(value));
}

export function resolveMinimumDraftLength(
  originalLength: number,
  policy: DraftCandidateLengthPolicy,
): number {
  const target: number | undefined = policy.targetLength;
  if (target !== undefined && target > 0) {
    return Math.ceil(Math.min(target, originalLength) * 0.9);
  }

  const retainedPercent: number =
    100 - normalizeMaxCompressionPercent(policy.maxCompressionPercent);
  return Math.ceil(originalLength * (retainedPercent / 100));
}

export function validateDraftCandidate(
  originalBody: string,
  candidateBody: string,
  policy: DraftCandidateLengthPolicy,
  options: { readonly requireShorter?: boolean } = {},
): DraftCandidateValidation {
  const candidate: string = candidateBody.trim();
  const candidateLength: number = candidate.length;
  const minimumLength: number = resolveMinimumDraftLength(originalBody.length, policy);

  if (candidateLength === 0) {
    return { accepted: false, candidateLength, minimumLength, reason: 'empty' };
  }

  if (looksLikeDraftMetaResponse(candidate)) {
    return { accepted: false, candidateLength, minimumLength, reason: 'meta-response' };
  }

  if (candidateLength < minimumLength) {
    return { accepted: false, candidateLength, minimumLength, reason: 'too-short' };
  }

  if (options.requireShorter && candidateLength >= originalBody.length) {
    return { accepted: false, candidateLength, minimumLength, reason: 'not-shorter' };
  }

  if (countSceneBreaks(candidate) !== countSceneBreaks(originalBody)) {
    return { accepted: false, candidateLength, minimumLength, reason: 'scene-breaks-changed' };
  }

  return { accepted: true, candidateLength, minimumLength };
}

function countSceneBreaks(text: string): number {
  return text.split('\n').filter((line) => line.trim() === '---').length;
}

function looksLikeDraftMetaResponse(text: string): boolean {
  const firstLine: string = text.split('\n', 1)[0]?.trim() ?? '';

  return /^(?:죄송|요청하신 .*?(?:불가|어렵)|다음과 같이|수정(?:한|된) 본문|설명:|요약:|분량.*?(?:한계|제한)|원하시면)/.test(
    firstLine,
  );
}

import { clampIntegerSetting, integerSettingDefault } from '@storyboard/story-model';

export { resolveSceneTargetLength } from '@storyboard/story-model';

export type DraftCandidateRejectionReason = 'empty' | 'meta-response' | 'too-short' | 'not-shorter';

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

// 허용 범위와 기본값은 설정 카탈로그가 갖는다. 여기서 다시 적으면 설정 화면이 허용한 값을 파이프라인이
// 잘라내는 상태로 갈라질 수 있다.
const maxCompressionPercentKey = 'revise.length.maxCompressionPercent';

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
  // NOTE: 이 하한은 압축을 막기 위한 것이므로 원본 길이를 넘어서는 안 된다. 목표에 미달한 원고에서
  // 하한을 원본 길이로 잡으면 한 글자라도 줄어든 수정본이 too-short로 기각돼(실측: 3% 짧아진 감수
  // 결과가 통째로 버려짐) 감수가 무력해진다. 목표에 닿은 원고만 목표 기준으로 지키고, 미달 원고는
  // 압축 허용 한도만 적용한다.
  const target = policy.targetLength;
  if (target !== undefined && target > 0 && originalLength >= target) {
    return Math.ceil(target * 0.9);
  }

  const retainedPercent = 100 - normalizeMaxCompressionPercent(policy.maxCompressionPercent);
  return Math.ceil(originalLength * (retainedPercent / 100));
}

export function validateDraftCandidate(
  originalBody: string,
  candidateBody: string,
  policy: DraftCandidateLengthPolicy,
  options: { readonly requireShorter?: boolean } = {},
): DraftCandidateValidation {
  const candidate = candidateBody.trim();
  const candidateLength = candidate.length;
  const minimumLength = resolveMinimumDraftLength(originalBody.length, policy);

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

  return { accepted: true, candidateLength, minimumLength };
}

function looksLikeDraftMetaResponse(text: string): boolean {
  const firstLine = text.split('\n', 1)[0]?.trim() ?? '';

  return /^(?:죄송|요청하신 .*?(?:불가|어렵)|다음과 같이|수정(?:한|된) 본문|설명:|요약:|분량.*?(?:한계|제한)|원하시면)/.test(
    firstLine,
  );
}

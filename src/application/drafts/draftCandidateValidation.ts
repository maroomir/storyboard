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

const MIN_COMPRESSION_PERCENT = 0;
const MAX_COMPRESSION_PERCENT = 90;

export function normalizeMaxCompressionPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }

  return Math.min(MAX_COMPRESSION_PERCENT, Math.max(MIN_COMPRESSION_PERCENT, Math.floor(value)));
}

export function resolveMinimumDraftLength(
  originalLength: number,
  policy: DraftCandidateLengthPolicy,
): number {
  if (policy.targetLength !== undefined && policy.targetLength > 0) {
    return Math.ceil(policy.targetLength * 0.9);
  }

  const retainedPercent = 100 - normalizeMaxCompressionPercent(policy.maxCompressionPercent);
  return Math.ceil(originalLength * (retainedPercent / 100));
}

export function resolveSceneTargetLength(
  frontmatterTargetLength: number | undefined,
  sceneBody: string,
): number | undefined {
  if (frontmatterTargetLength !== undefined && frontmatterTargetLength > 0) {
    return frontmatterTargetLength;
  }

  const match = /\[목표 분량\]\s*\n?\s*(?:약\s*)?([\d,]+)\s*자/.exec(sceneBody);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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

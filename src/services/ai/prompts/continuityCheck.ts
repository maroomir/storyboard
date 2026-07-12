import { type PromptArtifact, type PromptVariantId } from './types';
import { type Severity } from '@/shared/draftReview';

export interface ContinuityIssuePayload {
  readonly start: number;
  readonly end: number;
  readonly original: string;
  readonly reason: string;
  readonly severity: Severity;
}

export const ContinuityCheckPrompt = {
  config: {
    temperature: 0.1,
    maxTokens: 2000,
  },
  build(
    body: string,
    facts: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return variant === 'xs' ? buildXs(body, facts) : buildGeneric(body, facts);
  },
} as const;

function buildGeneric(body: string, facts: readonly string[]): PromptArtifact {
  return {
    system: [
      '한국어 소설의 설정 연속성 검사 도우미다.',
      '[설정]에 명시된 정전(canon) 사실과 본문이 모순되는 구간만 찾아라.',
      '설정에 없는 내용은 추측하지 말고, 명백히 어긋나는 구간만 보고하라.',
      '설명 없이 JSON 배열만 출력하라.',
      '[{"start":0,"end":0,"original":"","reason":"","severity":"high"}]',
      'start/end는 UTF-16 0-based, end는 exclusive다. reason에는 어떤 설정과 어떻게 모순되는지 적어라.',
      'severity는 "high"(설정과 직접 모순) 또는 "low"(모순 의심이나 해석상 양립 가능)로 표기하라.',
    ].join('\n'),
    user: ['[설정]', facts.join('\n'), '', '[본문]', body].join('\n'),
  };
}

function buildXs(body: string, facts: readonly string[]): PromptArtifact {
  return {
    system:
      '설정과 모순되는 본문 구간만 JSON 배열로 반환: [{"start":0,"end":0,"original":"","reason":"","severity":"high"}] (UTF-16 offset). severity: high=직접 모순, low=의심.',
    user: ['[설정]', facts.join('\n'), '[본문]', body].join('\n'),
  };
}

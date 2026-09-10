import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export const GrammarCheckPrompt = {
  config: promptTuning('grammarCheck'),
  build(body: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(body) : buildGeneric(body);
  },
} as const;

function buildGeneric(body: string): PromptArtifact {
  return {
    system: [
      '한국어 문장 교정 도우미다.',
      '본문에서 문법/맞춤법/띄어쓰기 문제만 추출하라.',
      '설명 없이 JSON 배열만 출력하라.',
      '[{"start":0,"end":0,"original":"","suggestion":"","reason":""}]',
      'start/end는 UTF-16 0-based, end는 exclusive다.',
    ].join('\n'),
    user: ['[본문]', body].join('\n'),
  };
}

function buildXs(body: string): PromptArtifact {
  return {
    system:
      '문법 오류만 JSON 배열로 반환: [{"start":0,"end":0,"original":"","suggestion":"","reason":""}] (UTF-16 offset).',
    user: body,
  };
}

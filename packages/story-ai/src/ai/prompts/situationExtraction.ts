import { type PromptArtifact, type PromptVariantId } from './types';

export const SituationExtractionPrompt = {
  config: {
    temperature: 0.3,
    maxTokens: 1000,
  },
  build(input: string, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(input) : buildGeneric(input);
  },
} as const;

function buildGeneric(input: string): PromptArtifact {
  return {
    system: [
      '사용자 입력에서 상황과 참여 캐릭터를 모두 추출하라.',
      '모든 사건을 등장 순서대로 빠짐없이 담되, 한 문장·한 동작 단위로 과도하게 쪼개지 말고 의미 있는 장면 단위로 묶어라.',
      '[필요 설정]·[회수할 복선] 블록은 장면의 배경 전제와 작가 메모다. 그 내용을 사건으로 추출하지 말고, 본문이 서술하는 실제 사건만 담아라.',
      '출력은 한국어 JSON 배열만 허용한다.',
      '각 항목: {"characters":string[],"situation":string}.',
      'situation은 가능한 원문 표현을 유지하라.',
    ].join('\n'),
    user: ['[입력 본문]', input].join('\n'),
  };
}

function buildXs(input: string): PromptArtifact {
  return {
    system: ['상황 추출기. JSON 배열만 출력: {"characters":[],"situation":""}.'].join('\n'),
    user: input,
  };
}

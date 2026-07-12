import { type PromptArtifact, type PromptVariantId } from './types';

export interface ChapterSummaryInput {
  readonly chapterTitle: string;
  readonly body: string;
}

export const ChapterSummaryPrompt = {
  config: {
    temperature: 0.3,
    maxTokens: 600,
  },
  build(input: ChapterSummaryInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(input) : buildGeneric(input);
  },
} as const;

function buildGeneric(input: ChapterSummaryInput): PromptArtifact {
  return {
    system: [
      '한국어 장편 소설의 한 장(chapter) 본문을 3~5문장으로 요약하는 도우미다.',
      '핵심 사건, 인물의 변화, 다음 장으로 이어지는 갈등을 중심으로 압축하라.',
      '설명이나 머리말 없이 요약문만 출력하라.',
    ].join('\n'),
    user: buildUserBlock(input),
  };
}

function buildXs(input: ChapterSummaryInput): PromptArtifact {
  return {
    system: '이 장 본문을 3~5문장으로 요약하라. 요약문만 출력하라.',
    user: buildUserBlock(input),
  };
}

function buildUserBlock(input: ChapterSummaryInput): string {
  return [`[장 제목]\n${input.chapterTitle}`, `[본문]\n${input.body}`].join('\n\n');
}

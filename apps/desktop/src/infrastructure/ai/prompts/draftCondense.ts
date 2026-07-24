import type { ProjectFormat } from '@storyboard/story-format';
import { type PromptArtifact, type PromptVariantId } from './types';

export interface DraftCondenseInput {
  readonly body: string;
  readonly format: ProjectFormat;
  readonly targetLength: number;
  readonly intent?: string;
  readonly facts?: readonly string[];
  readonly characterCards?: readonly string[];
}

export const DraftCondensePrompt = {
  config: {
    temperature: 0.4,
    maxTokens: 4000,
  },
  build(input: DraftCondenseInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const system =
      variant === 'xs'
        ? '본문의 사건 순서와 말투를 보존하며 목표 분량으로 축소하라. 설명 없이 본문만 출력하라.'
        : [
            '한국어 장편 소설 초안을 의도적으로 축소하는 편집자다.',
            '사건 순서, 인과, 필수 대사, 설정, 인물 말투와 문체를 보존하라.',
            '새 사건을 만들거나 결말·장면을 생략하지 말고, 반복·장황한 묘사만 줄여라.',
            `최종 본문은 약 ${input.targetLength}자까지 축소하되, 이보다 지나치게 짧게 만들지 마라.`,
            '설명, 머리말, 요약 표식 없이 축소한 본문 전체만 출력하라.',
          ].join('\n');

    const sections: string[] = [];
    if (input.intent?.trim()) {
      sections.push(`[장면 의도]\n${input.intent}`);
    }
    if (input.facts && input.facts.length > 0) {
      sections.push(`[설정]\n${input.facts.join('\n')}`);
    }
    if (input.characterCards && input.characterCards.length > 0) {
      sections.push(`[캐릭터 카드]\n${input.characterCards.join('\n\n')}`);
    }
    sections.push(`[본문]\n${input.body}`);

    return { system, user: sections.join('\n\n') };
  },
} as const;

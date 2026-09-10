import type { ProjectFormat } from '@storyboard/story-format';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface DraftRevisionInput {
  readonly body: string;
  readonly format: ProjectFormat;
  readonly instructions: readonly string[];
  readonly intent: string;
  readonly facts: readonly string[];
  readonly characterCards?: readonly string[];
}

export const DraftRevisionPrompt = {
  config: promptTuning('draftRevision'),
  build(input: DraftRevisionInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(input) : buildGeneric(input);
  },
} as const;

function buildGeneric(input: DraftRevisionInput): PromptArtifact {
  return {
    system: [
      '한국어 장편 소설 초안을 지시에 따라 다시 쓰는 작가다.',
      '아래 [지시]를 모두 반영해 본문을 수정하되, 지시와 무관한 부분의 분위기와 문체는 유지한다.',
      '[캐릭터 카드]의 말투·보이스는 최우선 불변 조건이다. [지시]와 충돌하면 캐릭터 카드를 따르고 기존 보이스를 보존하라.',
      '설정([설정])과 장면 의도([장면 의도])를 어기지 마라.',
      '본문에 있는 장면 구분 표식(단독 줄의 --- 또는 연속 빈 줄)은 장면 전환 표시이므로 위치와 형태를 그대로 유지하라.',
      '설명·머리말 없이 수정된 본문 전체만 출력하라.',
    ].join('\n'),
    user: buildUserBlock(input),
  };
}

function buildXs(input: DraftRevisionInput): PromptArtifact {
  return {
    system:
      '아래 지시를 반영하되 [캐릭터 카드]의 말투·보이스를 최우선으로 보존하라. 설명 없이 수정된 본문 전체만 출력하라.',
    user: buildUserBlock(input),
  };
}

function buildUserBlock(input: DraftRevisionInput): string {
  const sections: string[] = [
    `[지시]\n${input.instructions.map((item) => `- ${item}`).join('\n')}`,
  ];

  if (input.intent.trim().length > 0) {
    sections.push(`[장면 의도]\n${input.intent}`);
  }
  if (input.facts.length > 0) {
    sections.push(`[설정]\n${input.facts.join('\n')}`);
  }
  if (input.characterCards && input.characterCards.length > 0) {
    sections.push(`[캐릭터 카드]\n${input.characterCards.join('\n\n')}`);
  }

  sections.push(`[본문]\n${input.body}`);

  return sections.join('\n\n');
}

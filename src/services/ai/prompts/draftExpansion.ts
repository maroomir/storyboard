import { type PromptArtifact, type PromptVariantId } from './types';

export interface DraftExpansionPromptContext {
  readonly activeCharacter?: string;
  readonly background?: string;
}

export const DraftExpansionPrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 2400,
  },
  build(
    selection: string,
    context: DraftExpansionPromptContext = {},
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return variant === 'xs' ? buildXs(selection, context) : buildGeneric(selection, context);
  },
} as const;

function buildGeneric(selection: string, context: DraftExpansionPromptContext): PromptArtifact {
  return {
    system: [
      '장면 확장 전문 작가다.',
      '선택 본문을 같은 문체/시점으로 2~4배 자연스럽게 확장하라.',
      '새 정보는 최소화하고 기존 의미를 유지하며 밀도만 높여라.',
      '출력은 확장된 본문만 허용한다.',
    ].join('\n'),
    user: [
      context.activeCharacter ? `활성 캐릭터: ${context.activeCharacter}` : undefined,
      context.background ? `배경: ${context.background}` : undefined,
      '',
      '[선택 영역]',
      selection,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
  };
}

function buildXs(selection: string, context: DraftExpansionPromptContext): PromptArtifact {
  return {
    system: '선택 본문을 같은 문체로 2~4배 확장. 의미 유지, 결과 본문만 출력.',
    user: [
      context.activeCharacter ? `활성 캐릭터: ${context.activeCharacter}` : undefined,
      context.background ? `배경: ${context.background}` : undefined,
      selection,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
  };
}

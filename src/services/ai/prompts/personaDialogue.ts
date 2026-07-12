import type { Background } from '@/domain/Background';
import { joinCardText } from '@/shared/card';
import { voiceStyleLines, type StyleDirective } from '@/shared/styleDirective';
import { type PromptArtifact, type PromptVariantId } from './types';

function buildSystemLines(
  variant: PromptVariantId,
  background: Background,
  povInteriorityLine: string | undefined,
  style?: StyleDirective,
): (string | undefined)[] {
  return [
    variant === 'xs'
      ? "페르소나 기반 장면 작성. 형식: '캐릭터명: 대사'. 행동/감정도 포함."
      : '주어진 상황을 한 편의 소설 장면으로 극화하라. 대화만 뽑지 말고, 인물이 그 자리에 어떻게·언제 오게 됐는지(이동·도착·시간 경과)와 공간·행동을 서술로 그린 뒤 대사를 엮어라.',
    variant === 'rich' ? '장면 전개는 인물 간 긴장/목표/갈등이 드러나도록 구성하라.' : undefined,
    variant === 'xs' ? undefined : "대화는 '캐릭터명: 대사' 형식을 사용하라.",
    variant === 'xs' ? undefined : '행동, 표정, 감정을 함께 서술하라.',
    variant === 'xs'
      ? undefined
      : '대사가 적거나 없는 행동·전환 비트(혼자 걷는 길, 잠긴 문, 문이 열리는 순간 등)도 생략하지 말고 장면으로 충실히 그려라.',
    variant === 'xs'
      ? undefined
      : '이전 장면과 시간·장소·등장인물이 바뀌면 그 전환(이동·시간 경과·도착)을 먼저 묘사하고, 이어지는 장면이면 도입을 반복하지 말고 자연스럽게 연결하라.',
    variant === 'xs'
      ? undefined
      : '인물의 성격·사연·감정은 한꺼번에 설명하지 말고 행동과 대사로 조금씩 드러내며 장면이 진행될수록 긴장을 쌓아라.',
    variant === 'xs'
      ? undefined
      : '상황과 페르소나에 주어진 사실만 사용하고, 입력에 없는 새로운 사건·설정·인물·배경을 지어내지 마라.',
    variant === 'xs'
      ? undefined
      : '상황에서 이름만 언급되거나 아직 도착하지 않은(앞으로 올) 인물은 그 장면에 등장시키거나 대사를 주지 마라. 실제로 그 자리에 있는 인물만 다뤄라.',
    variant === 'xs'
      ? undefined
      : '상황에 인물의 폭언·별칭·직접 대사가 드러나면 순화하거나 화해로 덮지 말고 그 표현을 그대로 살려 대사로 옮겨라.',
    variant === 'xs' ? undefined : povInteriorityLine,
    joinCardText(background.description)
      ? `배경 설명: ${joinCardText(background.description)}`
      : undefined,
    background.tags && background.tags.length > 0
      ? `태그: ${background.tags.join(', ')}`
      : undefined,
    ...(variant === 'xs' ? [] : voiceStyleLines(style)),
  ];
}

export const PersonaDialoguePrompt = {
  config: {
    temperature: 0.8,
    maxTokens: 2000,
  },
  build(
    situation: string,
    personas: ReadonlyMap<string, string>,
    background: Background,
    previousContext?: string,
    variant: PromptVariantId = 'generic',
    style?: StyleDirective,
  ): PromptArtifact {
    const povInteriorityLine =
      style?.pov === 'first' || style?.pov === 'third-limited'
        ? '시점 화자의 내면 독백(생각·판단·자기합리화·감정)을 대사 사이에 충분히 녹여라.'
        : undefined;

    const system = buildSystemLines(variant, background, povInteriorityLine, style)
      .filter((line): line is string => Boolean(line))
      .join('\n');

    const personaLines = Array.from(personas.entries()).flatMap(([name, persona]) => [
      '',
      `[${name}]`,
      persona,
    ]);

    const user = [
      personaLines.length > 0 ? '등장 캐릭터 페르소나:' : undefined,
      ...personaLines,
      previousContext ? `\n이전 장면:\n${previousContext}` : undefined,
      `\n상황:\n${situation}`,
      '\n위 상황에서 캐릭터들의 대화와 행동을 작성하라.',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');

    return { system, user };
  },
} as const;

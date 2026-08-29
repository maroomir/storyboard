import {
  proseConventionLines,
  voiceStyleLines,
  type StyleDirective,
} from '../../contracts/styleDirective';
import { type PromptArtifact, type PromptVariantId } from './types';

export interface SceneDialoguePolishInput {
  readonly skeleton: string;
  readonly personas: ReadonlyMap<string, string>;
  readonly style?: StyleDirective;
}

// NOTE: 뼈대는 사건 배치와 대사 작성을 한꺼번에 하느라 대사가 성기고 말투가 뭉개진다. 살붙임은
// 대사를 더하지 못하므로(사건 보존이 우선) 살이 붙을수록 대화 밀도가 오히려 묽어진다. 그래서
// 살붙임 전에 대사만 손보는 단계를 둔다. 여기서 늘어난 대사는 이후 모든 구간에 그대로 실린다.
export const SceneDialoguePolishPrompt = {
  config: {
    temperature: 0.8,
    maxTokens: 8000,
  },
  build(input: SceneDialoguePolishInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(input) : buildGeneric(input);
  },
} as const;

function buildGeneric(input: SceneDialoguePolishInput): PromptArtifact {
  return {
    system: [
      '장면의 뼈대를 받아 대사만 손본다. 사건과 행동은 그대로 두고, 인물들이 주고받는 말을 그 인물답게 고쳐라.',
      '각 인물의 페르소나에 적힌 말투·어휘·호칭을 대사에 그대로 반영하라. 누가 말했는지 이름을 지우고 읽어도 구분될 만큼 서로 다르게 써라.',
      '대화가 오가는 맛을 살려라. 한 번 말하고 끝나는 자리는 되묻거나 받아치게 하고, 인물이 반응해야 할 자리에 침묵 대신 말을 두어라. 상대의 말을 자르거나 딴청을 부리는 것도 대화다.',
      '새로운 정보·결정·약속을 대사로 만들지 마라. 뼈대에 없던 사건을 말로 일으키는 것도 금지한다. 늘리는 것은 이미 있는 사건을 두고 오가는 말뿐이다.',
      '뼈대에 없는 인물을 등장시키거나 말하게 하지 마라.',
      '행동·이동을 적은 서술 문장과 단독 줄의 --- 표시는 위치와 내용을 그대로 두어라.',
      '설명이나 머리말 없이 손본 뼈대 전문만 한국어로 출력하라.',
      ...proseConventionLines,
      ...voiceStyleLines(input.style),
    ].join('\n'),
    user: buildUserBlock(input),
  };
}

function buildXs(input: SceneDialoguePolishInput): PromptArtifact {
  return {
    system:
      '뼈대의 대사만 인물의 말투에 맞게 고치고 주고받는 말을 늘려라. 사건·행동은 그대로. 대사는 곡선 큰따옴표로. 새 정보나 인물 금지. 전문만 출력.',
    user: buildUserBlock(input),
  };
}

function buildUserBlock(input: SceneDialoguePolishInput): string {
  const personaLines = Array.from(input.personas.entries()).flatMap(([name, persona]) => [
    '',
    `[${name}]`,
    persona,
  ]);

  return [
    personaLines.length > 0 ? '[등장 캐릭터 페르소나]' : undefined,
    ...personaLines,
    `\n[뼈대]\n${input.skeleton}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

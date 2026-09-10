import {
  proseConventionLines,
  voiceStyleLines,
  type StyleDirective,
} from '#ai/contracts/styleDirective';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneDialoguePolishInput {
  readonly skeleton: string;
  readonly personas: ReadonlyMap<string, string>;
  // 인물이 앞선 씬에서 실제로 한 말. 말투 기준점이며 프롬프트에 없으면 카드 예시 대사만 남는다.
  readonly voiceSamples?: ReadonlyMap<string, readonly string[]>;
  readonly style?: StyleDirective;
}

// NOTE: 뼈대는 사건 배치와 대사 작성을 한꺼번에 하느라 말투가 뭉개진다. 그래서 살붙임 전에 대사의
// 말투만 손보는 단계를 둔다. 턴을 늘리는 것은 이 단계의 일이 아니다. 새 정보를 담을 수 없는 자리에
// 턴만 더하면 앞 대사를 되풀이하는 빈 되묻기가 생기기 때문이다. 대화 밀도는 뼈대 단계가 책임진다.
export const SceneDialoguePolishPrompt = {
  config: promptTuning('sceneDialoguePolish'),
  build(input: SceneDialoguePolishInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(input) : buildGeneric(input);
  },
} as const;

function buildGeneric(input: SceneDialoguePolishInput): PromptArtifact {
  return {
    system: [
      '장면의 뼈대를 받아 대사만 손본다. 사건과 행동은 그대로 두고, 인물들이 주고받는 말을 그 인물답게 고쳐라.',
      '각 인물의 페르소나에 적힌 말투·어휘·호칭을 대사에 그대로 반영하라. 누가 말했는지 이름을 지우고 읽어도 구분될 만큼 서로 다르게 써라.',
      '대사의 개수와 순서는 뼈대 그대로 두어라. 대사를 새로 만들거나 하나를 둘로 쪼개지 마라. 앞 대사를 의문형으로 되풀이하는 턴은 특히 금지한다.',
      '새로운 정보·결정·약속을 대사로 만들지 마라. 뼈대에 없던 사건을 말로 일으키는 것도 금지한다. 고치는 것은 이미 있는 대사의 말투·어휘·호흡뿐이다.',
      '페르소나에 따옴표로 적힌 예시 대사는 말투를 알려 주는 참고일 뿐이다. 그 문장을 대사로 옮겨 쓰지 마라.',
      '[이전 대사] 목록은 그 인물이 앞선 장면에서 실제로 한 말이다. 어미·호칭·문장 길이를 여기에 맞춰라. 문장 자체를 옮겨 쓰는 것은 금지한다.',
      '뼈대에 없는 인물을 등장시키거나 말하게 하지 마라.',
      '행동·이동을 적은 서술 문장과 단독 줄의 --- 표시는 위치와 내용을 그대로 두어라.',
      '설명이나 머리말 없이 손본 뼈대 전문만 한국어로 출력하라.',
      ...proseConventionLines(input.style?.narration?.tense),
      ...voiceStyleLines(input.style),
    ].join('\n'),
    user: buildUserBlock(input),
  };
}

function buildXs(input: SceneDialoguePolishInput): PromptArtifact {
  return {
    system:
      '뼈대의 대사를 인물의 말투에 맞게 고쳐라. 대사 개수·순서·사건·행동은 그대로. 대사는 곡선 큰따옴표로. 새 대사나 정보나 인물 금지. 페르소나 예시 대사 복사 금지. 전문만 출력.',
    user: buildUserBlock(input),
  };
}

function buildUserBlock(input: SceneDialoguePolishInput): string {
  const personaLines = Array.from(input.personas.entries()).flatMap(([name, persona]) => {
    const samples = input.voiceSamples?.get(name) ?? [];
    const sampleLines =
      samples.length > 0 ? ['[이전 대사]', ...samples.map((sample) => `- ${sample}`)] : [];

    return ['', `[${name}]`, persona, ...sampleLines];
  });

  return [
    personaLines.length > 0 ? '[등장 캐릭터 페르소나]' : undefined,
    ...personaLines,
    `\n[뼈대]\n${input.skeleton}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

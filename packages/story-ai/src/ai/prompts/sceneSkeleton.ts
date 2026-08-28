import type { Background } from '@storyboard/story-format';
import { joinCardText } from '@storyboard/story-format';
import type { SceneGrounding } from '@storyboard/story-format';
import {
  craftContractLines,
  sceneGroundingLines,
  voiceStyleLines,
  type StyleDirective,
} from '../../contracts/styleDirective';
import { type PromptArtifact, type PromptVariantId } from './types';

export interface SceneSkeletonInput {
  readonly narrativeSource: string;
  readonly personas: ReadonlyMap<string, string>;
  readonly background: Background;
  readonly previousContext?: string;
  readonly endState?: string;
  readonly grounding?: SceneGrounding;
  readonly style?: StyleDirective;
}

// NOTE: 씬의 뼈대를 한 번에 쓴다. 사건 순서·등장·종료 지점 같은 연속성 결정이 전부 이 한 문맥에서
// 내려지므로, 뒤 단계는 문장만 다듬으면 되고 "이미 나온 인물"을 실어 나를 필요가 없어진다.
export const SceneSkeletonPrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 8000,
  },
  build(input: SceneSkeletonInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(input) : buildGeneric(input);
  },
} as const;

function buildGeneric(input: SceneSkeletonInput): PromptArtifact {
  const style = input.style;

  return {
    system: [
      '주어진 사건 목록을 한 편의 장면으로 옮기되, 아직 살은 붙이지 마라. 이 단계의 결과물은 뒤에서 묘사를 더할 뼈대다.',
      '사건을 순서대로 빠짐없이 담고, 인물이 언제 등장하고 언제 자리를 뜨는지, 장면이 어디서 끝나는지를 분명히 하라.',
      '대사는 실제로 쓸 문장을 따옴표로 적어라. 행동과 이동은 짧은 서술로 적되, 감각 묘사·회상·긴 내면 독백은 넣지 마라.',
      '한 인물이 이미 그 자리에 있으면 다시 등장시키지 말고, 이미 벌어진 일은 다시 일으키지 마라.',
      '입력에 없는 새로운 사건·설정·인물을 지어내지 마라.',
      '시간이나 장소가 바뀌는 지점에는 단독 줄에 --- 를 넣어 장면 전환을 표시하라.',
      input.endState
        ? `장면은 여기서 닫힌다: ${input.endState} 그 뒤에 이어질 일은 다음 장면의 몫이므로 쓰지 마라.`
        : undefined,
      '설명이나 머리말 없이 뼈대 본문만 한국어로 출력하라.',
      ...(style ? voiceStyleLines(style) : []),
      ...craftContractLines(style?.craftContract),
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n'),
    user: buildUserBlock(input),
  };
}

function buildXs(input: SceneSkeletonInput): PromptArtifact {
  return {
    system:
      '사건 목록을 장면의 뼈대로 옮겨라. 대사는 따옴표로, 행동은 짧게. 묘사·회상은 넣지 마라. 한국어 본문만 출력.',
    user: buildUserBlock(input),
  };
}

function buildUserBlock(input: SceneSkeletonInput): string {
  const personaLines = Array.from(input.personas.entries()).flatMap(([name, persona]) => [
    '',
    `[${name}]`,
    persona,
  ]);
  const groundingBlock = sceneGroundingLines(input.grounding);
  const backgroundDescription = joinCardText(input.background.description);

  return [
    groundingBlock.length > 0 ? groundingBlock.join('\n') : undefined,
    backgroundDescription ? `[배경]\n${backgroundDescription}` : undefined,
    personaLines.length > 0 ? '[등장 캐릭터 페르소나]' : undefined,
    ...personaLines,
    input.previousContext ? `\n[이전 맥락]\n${input.previousContext}` : undefined,
    `\n[이 장면의 사건]\n${input.narrativeSource}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

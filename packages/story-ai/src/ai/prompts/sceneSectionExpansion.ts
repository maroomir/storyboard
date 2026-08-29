import {
  craftContractLines,
  proseConventionLines,
  narrativeStyleLines,
  type StyleDirective,
} from '../../contracts/styleDirective';
import { type PromptArtifact, type PromptVariantId } from './types';

export interface SceneSectionExpansionInput {
  readonly skeleton: string;
  readonly section: string;
  readonly previousSection?: string;
  readonly targetLength: number;
  readonly retryReasons?: readonly string[];
  readonly style?: StyleDirective;
}

// NOTE: 뼈대가 이미 사건·등장·순서를 확정했으므로 이 단계는 문장만 두껍게 한다. 씬 전체 뼈대를
// 함께 주어 앞뒤에 무슨 일이 있는지 보이게 하고, 직전 구간 완성문으로 문체와 호흡을 잇는다.
export const SceneSectionExpansionPrompt = {
  config: {
    temperature: 0.75,
    maxTokens: 8000,
  },
  build(input: SceneSectionExpansionInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return variant === 'xs' ? buildXs(input) : buildGeneric(input);
  },
} as const;

function buildGeneric(input: SceneSectionExpansionInput): PromptArtifact {
  return {
    system: [
      '장면의 뼈대 가운데 [이번 구간]만 완성된 소설 본문으로 살을 붙여라.',
      '뼈대에 적힌 사건·대사·등장 순서는 하나도 바꾸지 마라. 사건을 더하거나 빼지 말고, 뼈대에 없는 인물을 등장시키지 마라.',
      '뼈대의 따옴표 대사는 그대로 살리되, 그 사이를 감각 묘사·행동·내면으로 채워 장면을 완성하라.',
      '[장면 전체 뼈대]는 앞뒤 맥락을 알기 위한 참고다. 이번 구간 밖의 사건은 쓰지 마라.',
      '[직전 구간]이 있으면 그 문체와 호흡을 이어받고, 이미 묘사된 공간·인물을 다시 소개하지 마라.',
      '뼈대에 단독 줄로 --- 가 있으면 장면 전환 표시이므로 위치와 형태를 그대로 유지하라.',
      `이번 구간의 목표 분량: 약 ${input.targetLength.toLocaleString()}자 (공백 포함).`,
      '설명이나 머리말 없이 완성된 본문만 한국어로 출력하라.',
      ...proseConventionLines,
      ...narrativeStyleLines(stripLength(input.style)),
      ...craftContractLines(input.style?.craftContract),
      ...(input.retryReasons && input.retryReasons.length > 0
        ? [
            `앞서 쓴 결과가 다음 이유로 반려됐다. 이번에는 어기지 마라: ${input.retryReasons.join(' / ')}`,
          ]
        : []),
    ].join('\n'),
    user: buildUserBlock(input),
  };
}

function buildXs(input: SceneSectionExpansionInput): PromptArtifact {
  return {
    system:
      '뼈대의 [이번 구간]만 소설 본문으로 확장하라. 사건·대사·등장은 그대로, 묘사만 추가. 한국어 본문만 출력.',
    user: buildUserBlock(input),
  };
}

// 구간별 목표는 시스템 문장에서 따로 밝히므로, 씬 전체 목표가 겹쳐 들어가지 않게 뺀다.
function stripLength(style: StyleDirective | undefined): StyleDirective | undefined {
  if (!style || style.targetWordCount === undefined) {
    return style;
  }

  const { targetWordCount: _unused, ...rest } = style;
  return rest;
}

function buildUserBlock(input: SceneSectionExpansionInput): string {
  return [
    `[장면 전체 뼈대]\n${input.skeleton}`,
    input.previousSection ? `\n[직전 구간 — 이미 완성됨]\n${input.previousSection}` : undefined,
    `\n[이번 구간 — 이 부분만 확장하라]\n${input.section}`,
  ]
    .filter((block): block is string => Boolean(block))
    .join('\n');
}

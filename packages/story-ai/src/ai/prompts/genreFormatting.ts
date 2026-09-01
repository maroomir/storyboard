import type { ProjectFormat } from '@storyboard/story-format';
import {
  craftContractLines,
  narrativeStyleLines,
  type StyleDirective,
} from '#ai/contracts/styleDirective';
import { type PromptArtifact, type PromptVariantId } from './types';

const formatGuides: Readonly<Record<ProjectFormat, string>> = {
  novel:
    '소설 형식으로 서술하라. 대사 사이를 감각 묘사·내면 독백·행동으로 채우되, 그 대목이 하는 일에 따라 밀도를 달리하라 — 사건이 움직이는 대목은 곧게, 정서가 머무는 대목은 두텁게.',
  screenplay: '시나리오 형식으로 대사와 행동을 명확히 구분하세요.',
  play: "희곡 형식으로 '인물명: 대사'와 지문 중심으로 작성하세요.",
  essay: '수필 형식으로 서술 중심으로 재작성하세요.',
  poem: '시 형식으로 행과 이미지를 살려 재작성하세요.',
};

export const GenreFormattingPrompt = {
  config: {
    temperature: 0.5,
    maxTokens: 12000,
  },
  build(
    dialogue: string,
    format: ProjectFormat,
    variant: PromptVariantId = 'generic',
    style?: StyleDirective,
  ): PromptArtifact {
    if (variant === 'xs') {
      return buildXs(dialogue, format);
    }

    if (variant === 'rich') {
      return buildRich(dialogue, format, style);
    }

    return buildGeneric(dialogue, format, style);
  },
} as const;

function buildGeneric(
  dialogue: string,
  format: ProjectFormat,
  style?: StyleDirective,
): PromptArtifact {
  return {
    system: [
      `전문 작가처럼 장면을 ${format} 형식으로 작성하라.`,
      formatGuides[format],
      '입력은 장면의 압축된 골자다. 사건 순서·대사 의미·인물 관계는 보존하되, 비어 있는 묘사와 정서를 채워 장면을 풍부하게 완성하라.',
      '입력에 없는 새로운 사건·설정·인물은 만들어내지 마라.',
      '출력은 한국어로 작성하라.',
      ...narrativeStyleLines(style),
      ...craftContractLines(style?.craftContract),
    ].join('\n'),
    user: dialogue,
  };
}

function buildXs(dialogue: string, format: ProjectFormat): PromptArtifact {
  return {
    system: [`${format} 형식으로 재작성. 의미 유지, 형식만 변경, 한국어 출력.`].join('\n'),
    user: dialogue,
  };
}

function buildRich(
  dialogue: string,
  format: ProjectFormat,
  style?: StyleDirective,
): PromptArtifact {
  return {
    system: [
      `전문 작가처럼 장면을 ${format} 형식으로 작성하라.`,
      formatGuides[format],
      '입력은 장면의 압축된 골자다. 사건 순서·대화 의미·감정 흐름·인물 관계는 보존하되, 감각 묘사·내면·호흡을 살려 장면을 완성하라.',
      '입력의 모든 장면과 대사를 빠짐없이 포함하고 요약하거나 압축하지 마라. 다만 분량을 임의로 부풀리지 말고 입력의 밀도와 호흡을 유지하라.',
      '시간·장소가 바뀌는 지점에서 장면을 명확히 구분하고, 각 장면의 도입(등장 경위·공간)과 장면 사이의 전환을 자연스럽게 이어라. 대사 없이 행동만 있는 대목도 장면으로 살려 두어라.',
      '인물의 폭언·별칭·갈등·실망 같은 거친 표현은 순화하거나 화해로 덮지 말고 그 강도 그대로 살려라.',
      '입력에 없는 새로운 사건·설정·인물은 추가하지 마라. 문장 리듬과 단락 구조는 형식 규칙에 맞게 다듬어라.',
      '오직 완성된 소설 본문만 출력하라. 분량·토큰·작업 방식에 대한 안내, 연재형/압축형 같은 선택지 제시, 사용자에게 묻는 말 등 어떤 메타 설명도 출력하지 마라.',
      '시간이나 장소가 바뀌어 장면이 전환되는 지점에만 단독 줄에 --- 를 넣어 표시하라. 같은 시간·장소 안의 문단 바꿈에는 쓰지 말고, *** 같은 다른 기호도 쓰지 마라.',
      '같은 표현이나 상투구를 반복하지 말고 변주하라.',
      '출력은 한국어로 작성하라.',
      ...narrativeStyleLines(style),
      ...craftContractLines(style?.craftContract),
    ].join('\n'),
    user: dialogue,
  };
}

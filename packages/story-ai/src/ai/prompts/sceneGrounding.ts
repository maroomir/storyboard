import { sceneGroundingFieldLabels, type SceneGroundingFieldKey } from '@storyboard/story-format';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneGroundingPromptInput {
  readonly sceneBody: string;
  readonly missingFields: readonly SceneGroundingFieldKey[];
  readonly characterNames: readonly string[];
  readonly knownGrounding: readonly string[];
}

const fieldGuides: Readonly<Record<SceneGroundingFieldKey, string>> = {
  incident: '오늘 이 인물에게 실제로 벌어진 사건 하나. 감정이 아니라 사건으로 적어라.',
  place: '장면이 벌어지는 구체적인 공간. 은유가 아니라 실제 장소로 적어라.',
  relation: '등장인물들이 서로 어떤 사이인지. 만난 경위와 거리감이 드러나게 적어라.',
  time: '계절·시각 등 장면이 놓인 시점.',
};

export const SceneGroundingPrompt = {
  config: promptTuning('sceneGrounding'),
  build(input: SceneGroundingPromptInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const requested = input.missingFields.map(
      (key) => `- ${key} (${sceneGroundingFieldLabels[key]}): ${fieldGuides[key]}`,
    );

    if (variant === 'xs') {
      return {
        system: `씬을 구체화한다. JSON 객체만 출력: {${input.missingFields.map((key) => `"${key}":""`).join(',')}}.`,
        user: input.sceneBody,
      };
    }

    return {
      system: [
        '씬 본문을 읽고, 이 장면을 구체적인 사건으로 못박는 사실을 제안하라.',
        '본문이 가사나 분위기 스케치처럼 추상적이면, 그 정서에 어울리는 구체적 상황을 새로 정해도 좋다.',
        '각 항목은 한 문장으로 짧게 쓰고, 은유·수식 없이 사실만 적어라.',
        '인물은 반드시 주어진 이름으로만 부르고, 카드 id나 영문 슬러그를 그대로 쓰지 마라.',
        '출력은 한국어 JSON 객체만 허용한다. 요청된 키만 담아라.',
        `요청 항목:\n${requested.join('\n')}`,
      ].join('\n'),
      user: [
        input.characterNames.length > 0
          ? `[등장인물]\n${input.characterNames.join(', ')}`
          : undefined,
        input.knownGrounding.length > 0
          ? `[이미 확정된 사실 — 이와 모순되지 않게 제안하라]\n${input.knownGrounding.join('\n')}`
          : undefined,
        `[씬 본문]\n${input.sceneBody}`,
      ]
        .filter((section): section is string => Boolean(section))
        .join('\n\n'),
    };
  },
} as const;

import { sceneSeedSectionLabels } from '@storyboard/story-format';
import { type PromptArtifact, type PromptVariantId } from './types';

export type SceneStructureFieldKey =
  | 'purpose'
  | 'conflict'
  | 'twist'
  | 'emotionalShift'
  | 'endState'
  | 'foreshadowing'
  | 'neededCanon';

export interface SceneStructurePromptInput {
  readonly sceneSummary: string;
  readonly missingFields: readonly SceneStructureFieldKey[];
  readonly knownFields: readonly string[];
}

const fieldGuides: Readonly<Record<SceneStructureFieldKey, string>> = {
  purpose: '이 장면이 이야기에서 해내야 하는 일 하나를 한 문장으로.',
  conflict: '장면 안에서 맞부딪히는 욕구나 입장을 한 문장으로.',
  twist: '장면 끝에서 드러나는 전환이나 새 정보. 없으면 비워 두라.',
  emotionalShift: '장면을 지나며 인물의 상태가 어떻게 달라지는지.',
  endState:
    '이 장면이 멈추는 지점. 요약의 마지막 사건을 기준으로, 다음 장면이 이어받을 자리를 한 문장으로.',
  foreshadowing: '뒤에서 회수할 복선을 짧은 구 목록으로.',
  neededCanon: '이 장면이 전제하는 설정 사실을 짧은 문장 목록으로.',
};

const listFields: readonly SceneStructureFieldKey[] = ['foreshadowing', 'neededCanon'];

export const SceneStructurePrompt = {
  config: {
    temperature: 0.7,
    maxTokens: 700,
  },
  build(input: SceneStructurePromptInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const requested = input.missingFields.map(
      (key) => `- ${key} (${sceneSeedSectionLabels[key]}): ${fieldGuides[key]}`,
    );
    const responseShape = input.missingFields
      .map((key) => (listFields.includes(key) ? `"${key}":[]` : `"${key}":""`))
      .join(',');

    if (variant === 'xs') {
      return {
        system: `씬 요약을 구조화한다. JSON 객체만 출력: {${responseShape}}.`,
        user: input.sceneSummary,
      };
    }

    return {
      system: [
        '씬 요약(자유 산문)을 읽고, 요청된 구조 필드를 제안하라.',
        '요약에 실제로 담긴 내용만 정리하고, 새 사건이나 인물을 지어내지 마라.',
        '각 항목은 한 문장으로 짧게 쓰고, 요약이 뒷받침하지 못하는 키는 빈 값으로 남겨라.',
        '출력은 한국어 JSON 객체만 허용한다. 요청된 키만 담아라.',
        `요청 항목:\n${requested.join('\n')}`,
      ].join('\n'),
      user: [
        input.knownFields.length > 0
          ? `[이미 작성된 필드 — 이와 모순되지 않게 제안하라]\n${input.knownFields.join('\n')}`
          : undefined,
        `[씬 요약]\n${input.sceneSummary}`,
      ]
        .filter((section): section is string => Boolean(section))
        .join('\n\n'),
    };
  },
} as const;

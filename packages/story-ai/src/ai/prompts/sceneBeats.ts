import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneBeatsPromptInput {
  readonly sceneBody: string;
  readonly summary?: string;
  readonly grounding: readonly string[];
  readonly characterNames: readonly string[];
  readonly beatCount: number;
}

// 초안 뼈대는 입력에 없는 사건을 지어내지 못하므로, 사건 비트의 수가 곧 분량의 상한이다.
// 창작자 요약이 있으면 그 사건을 더 작은 단계로 쪼개기만 하고, 없으면 구조 필드와 확정 사실을
// 전개해 사건을 정한다.
export const SceneBeatsPrompt = {
  config: promptTuning('sceneBeats'),
  build(input: SceneBeatsPromptInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const hasSummary = input.summary !== undefined && input.summary.trim().length > 0;

    if (variant === 'xs') {
      return {
        system: `씬을 시간 순서의 사건 ${input.beatCount}개로 나눈다. JSON 문자열 배열만 출력.`,
        user: [input.sceneBody, input.summary].filter(Boolean).join('\n\n'),
      };
    }

    return {
      system: [
        `이 장면을 시간 순서대로 이어지는 사건 비트 정확히 ${input.beatCount}개로 나눠라.`,
        '비트 하나는 행동·발견·결정·장소 이동처럼 눈에 보이는 사건 하나이며, 앞 비트와 구별되어야 한다.',
        '각 비트는 한두 문장의 사실 서술로 쓰고, 감정 형용이나 은유·수식 없이 무엇이 일어나는지만 적어라.',
        '첫 비트는 장면이 시작되는 순간, 마지막 비트는 [이 장면의 종료 지점]이며 그 뒤의 사건은 쓰지 마라.',
        '[회수할 복선]이 있으면 그 복선이 놓이는 비트를 반드시 포함하라.',
        hasSummary
          ? '[창작자 요약]에 적힌 사건만 다뤄라. 요약에 없는 새 사건·인물·장소를 더하지 말고, 요약의 사건을 그 안의 행동·반응·발견으로 잘게 나누고 순서를 정리하라.'
          : '요약이 없으므로 [목적]·[갈등]·[반전]·[감정 변화]와 확정 사실을 전개해 사건을 정하라. 카드에 없는 인물이나 설정은 만들지 마라.',
        '인물은 반드시 주어진 이름으로만 부르고, 카드 id나 영문 슬러그를 그대로 쓰지 마라.',
        '출력은 한국어 JSON 문자열 배열만 허용한다. 번호나 설명을 붙이지 마라.',
      ].join('\n'),
      user: [
        input.characterNames.length > 0
          ? `[등장인물]\n${input.characterNames.join(', ')}`
          : undefined,
        input.grounding.length > 0 ? input.grounding.join('\n') : undefined,
        `[씬 카드]\n${input.sceneBody}`,
        hasSummary ? `[창작자 요약]\n${input.summary?.trim()}` : undefined,
      ]
        .filter((section): section is string => Boolean(section))
        .join('\n\n'),
    };
  },
} as const;

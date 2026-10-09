import {
  craftContractLines,
  proseConventionLines,
  narrativeStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneSectionExpansionInput {
  readonly skeleton: string;
  readonly section: string;
  readonly previousSection?: string;
  readonly targetLength: number;
  // 이 씬의 배경 카드가 적어 둔 공간 사실(구조·층수·소품·감각). 씬 사이 재료(원장·캐넌)는 아니다.
  readonly backgroundFacts?: readonly string[];
  readonly retryReasons?: readonly string[];
  // 앞 판이 분량 미달로 반려됐다. 첫 판의 «못 미친 채 끝내라»는 채움 억제가 길이 요구와 충돌한다(#106).
  readonly isUnderLengthRetry?: boolean;
  readonly style?: StyleDirective;
}

// NOTE: 뼈대가 이미 사건·등장·순서를 확정했으므로 이 단계는 문장만 두껍게 한다. 씬 전체 뼈대를
// 함께 주어 앞뒤에 무슨 일이 있는지 보이게 하고, 직전 구간 완성문으로 문체와 호흡을 잇는다.
export const SceneSectionExpansionPrompt = {
  config: promptTuning('sceneSectionExpansion'),
  build(input: SceneSectionExpansionInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('sceneSectionExpansion', variant, {
      view: {
        targetLength: input.targetLength.toLocaleString(),
        hasRetryReasons: input.retryReasons !== undefined && input.retryReasons.length > 0,
        retryReasons: input.retryReasons?.join(' / '),
        isUnderLengthRetry: input.isUnderLengthRetry === true,
        hasBackgroundFacts: (input.backgroundFacts ?? []).length > 0,
        backgroundFacts: input.backgroundFacts ?? [],
        skeleton: input.skeleton,
        previousSection: input.previousSection,
        section: input.section,
      },
      partials: {
        proseConventions: proseConventionLines(input.style?.narration?.tense).join('\n'),
        narrativeStyle: narrativeStyleLines(stripLength(input.style)).join('\n'),
        craftContract: craftContractLines(input.style?.craftContract).join('\n'),
      },
    });
  },
} as const;

// 구간별 목표는 시스템 문장에서 따로 밝히므로, 씬 전체 목표가 겹쳐 들어가지 않게 뺀다.
function stripLength(style: StyleDirective | undefined): StyleDirective | undefined {
  if (!style || style.targetWordCount === undefined) {
    return style;
  }

  const { targetWordCount: _unused, ...rest } = style;
  return rest;
}

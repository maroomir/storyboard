import type { Background, SceneGrounding } from '@storyboard/story-model';
import {
  joinCardText,
  craftContractLines,
  narrationStyleLines,
  proseConventionLines,
  sceneGroundingLines,
  voiceStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { personaCatchphraseView } from './characterCatchphrases';
import { personaKnowledgeView } from './characterKnowledge';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneSkeletonInput {
  readonly narrativeSource: string;
  // 카드의 목적·갈등·반전 같은 설계 블록. 사건 재료와 섞으면 그대로 산문에 실리므로 따로 받는다.
  readonly design?: string;
  readonly personas: ReadonlyMap<string, string>;
  // 이름 → 반복해야 하는 입버릇. 예시 대사 복사 금지의 예외다.
  readonly catchphrases?: ReadonlyMap<string, readonly string[]>;
  // 이름 → 이 씬 이전에 그 인물이 아는 것. 없는 사실은 그 인물이 모른다.
  readonly characterKnowledge?: ReadonlyMap<string, readonly string[]>;
  readonly background: Background;
  // 배경 카드에서 함께 참일 수 없는 두 줄. 사건에 맞는 하나만 쓰라고 따로 싣는다.
  readonly backgroundConflicts?: readonly string[];
  readonly previousContext?: string;
  readonly endState?: string;
  readonly grounding?: SceneGrounding;
  readonly style?: StyleDirective;
  readonly targetLength?: number;
  readonly retryReasons?: readonly string[];
  // 사건 목록에 ⟪대목 n⟫ 으로 장면 전환 자리가 미리 정해져 있다. 모델은 그 자리에만 --- 를 쓴다.
  readonly plannedBreaks?: boolean;
}

// NOTE: 씬의 뼈대를 한 번에 쓴다. 사건 순서·등장·종료 지점 같은 연속성 결정이 전부 이 한 문맥에서
// 내려지므로, 뒤 단계는 문장만 다듬으면 되고 "이미 나온 인물"을 실어 나를 필요가 없어진다.
export const SceneSkeletonPrompt = {
  config: promptTuning('sceneSkeleton'),
  build(input: SceneSkeletonInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const style = input.style;

    return renderPrompt('sceneSkeleton', variant, {
      view: {
        targetLength: input.targetLength ? input.targetLength.toLocaleString() : undefined,
        design: input.design,
        endState: input.endState,
        hasRetryReasons: input.retryReasons !== undefined && input.retryReasons.length > 0,
        retryReasons: input.retryReasons?.join(' / '),
        backgroundDescription: joinCardText(input.background.description),
        hasBackgroundConflicts: (input.backgroundConflicts ?? []).length > 0,
        backgroundConflicts: input.backgroundConflicts ?? [],
        hasPersonas: input.personas.size > 0,
        personas: Array.from(input.personas.entries()).map(([name, persona]) => ({
          name,
          persona,
          ...personaCatchphraseView(name, input.catchphrases),
          ...personaKnowledgeView(name, input.characterKnowledge),
        })),
        previousContext: input.previousContext,
        narrativeSource: input.narrativeSource,
        plannedBreaks: input.plannedBreaks === true,
      },
      partials: {
        proseConventions: proseConventionLines(style?.narration?.tense).join('\n'),
        voiceStyle: (style
          ? [...narrationStyleLines(style.narration), ...voiceStyleLines(style)]
          : []
        ).join('\n'),
        craftContract: craftContractLines(style?.craftContract).join('\n'),
        grounding: sceneGroundingLines(input.grounding).join('\n'),
      },
    });
  },
} as const;

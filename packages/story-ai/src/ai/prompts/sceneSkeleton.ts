import type { Background } from '@storyboard/story-format';
import { joinCardText } from '@storyboard/story-format';
import type { SceneGrounding } from '@storyboard/story-format';
import {
  craftContractLines,
  proseConventionLines,
  sceneGroundingLines,
  voiceStyleLines,
  type StyleDirective,
} from '#ai/contracts/styleDirective';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneSkeletonInput {
  readonly narrativeSource: string;
  // 카드의 목적·갈등·반전 같은 설계 블록. 사건 재료와 섞으면 그대로 산문에 실리므로 따로 받는다.
  readonly design?: string;
  readonly personas: ReadonlyMap<string, string>;
  readonly background: Background;
  readonly previousContext?: string;
  readonly endState?: string;
  readonly grounding?: SceneGrounding;
  readonly style?: StyleDirective;
  readonly targetLength?: number;
  readonly retryReasons?: readonly string[];
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
        hasPersonas: input.personas.size > 0,
        personas: Array.from(input.personas.entries()).map(([name, persona]) => ({
          name,
          persona,
        })),
        previousContext: input.previousContext,
        narrativeSource: input.narrativeSource,
      },
      partials: {
        proseConventions: proseConventionLines(style?.narration?.tense).join('\n'),
        voiceStyle: (style ? voiceStyleLines(style) : []).join('\n'),
        craftContract: craftContractLines(style?.craftContract).join('\n'),
        grounding: sceneGroundingLines(input.grounding).join('\n'),
      },
    });
  },
} as const;

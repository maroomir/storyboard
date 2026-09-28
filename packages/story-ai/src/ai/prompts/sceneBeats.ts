import { renderPrompt } from './promptResource';
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

    return renderPrompt('sceneBeats', variant, {
      view: {
        beatCount: input.beatCount,
        sceneBody: input.sceneBody,
        summary: hasSummary ? input.summary?.trim() : undefined,
        hasCharacterNames: input.characterNames.length > 0,
        characterNames: input.characterNames.join(', '),
        grounding: input.grounding.join('\n'),
        xsMaterial: [input.sceneBody, input.summary].filter(Boolean).join('\n\n'),
      },
    });
  },
} as const;

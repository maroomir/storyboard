import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface DialogueAttributionCandidate {
  readonly id: string;
  readonly name: string;
}

export interface SceneDialogueAttributionInput {
  readonly skeleton: string;
  readonly lines: readonly string[];
  readonly candidates: readonly DialogueAttributionCandidate[];
}

// NOTE: 원고에는 손대지 않고 화자만 읽어내는 단계다. 본문 생성 프롬프트를 건드리지 않으려고 별도
// 호출로 분리했으므로, 여기서는 절대 문장을 고쳐 쓰지 않는다.
export const SceneDialogueAttributionPrompt = {
  config: promptTuning('sceneDialogueAttribution'),
  build(
    input: SceneDialogueAttributionInput,
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('sceneDialogueAttribution', variant, {
      view: {
        candidates: input.candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        })),
        skeleton: input.skeleton,
        numberedLines: input.lines.map((line, offset) => `${offset + 1}. ${line}`).join('\n'),
      },
    });
  },
} as const;

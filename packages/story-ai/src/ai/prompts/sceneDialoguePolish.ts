import {
  proseConventionLines,
  voiceStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface SceneDialoguePolishInput {
  readonly skeleton: string;
  readonly personas: ReadonlyMap<string, string>;
  // 인물이 앞선 씬에서 실제로 한 말. 말투 기준점이며 프롬프트에 없으면 카드 예시 대사만 남는다.
  readonly voiceSamples?: ReadonlyMap<string, readonly string[]>;
  readonly style?: StyleDirective;
}

// NOTE: 뼈대는 사건 배치와 대사 작성을 한꺼번에 하느라 말투가 뭉개진다. 그래서 살붙임 전에 대사의
// 말투만 손보는 단계를 둔다. 턴을 늘리는 것은 이 단계의 일이 아니다. 새 정보를 담을 수 없는 자리에
// 턴만 더하면 앞 대사를 되풀이하는 빈 되묻기가 생기기 때문이다. 대화 밀도는 뼈대 단계가 책임진다.
export const SceneDialoguePolishPrompt = {
  config: promptTuning('sceneDialoguePolish'),
  build(input: SceneDialoguePolishInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const voiceStyle = voiceStyleLines(input.style);

    return renderPrompt('sceneDialoguePolish', variant, {
      view: {
        hasVoiceStyle: voiceStyle.length > 0,
        hasPersonas: input.personas.size > 0,
        personas: Array.from(input.personas.entries()).map(([name, persona]) => {
          const samples = input.voiceSamples?.get(name) ?? [];

          return { name, persona, hasSamples: samples.length > 0, samples };
        }),
        skeleton: input.skeleton,
      },
      partials: {
        proseConventions: proseConventionLines(input.style?.narration?.tense).join('\n'),
        voiceStyle: voiceStyle.join('\n'),
      },
    });
  },
} as const;

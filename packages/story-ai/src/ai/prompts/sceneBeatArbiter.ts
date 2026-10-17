import {
  narrationStyleLines,
  proseConventionLines,
  sceneGroundingLines,
  voiceStyleLines,
  type SceneGrounding,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';
import type { SceneBeatProposal } from './sceneBeatActor';
import {
  renderBeatDirective,
  renderNextBeats,
  type SceneBeatDirective,
} from './sceneBeatBlocks';

export interface SceneBeatArbiterInput {
  readonly beat: SceneBeatDirective;
  readonly nextBeats: readonly SceneBeatDirective[];
  // 이름 → 그 배우의 제안. 제안을 못 읽은 배우는 undefined 로 실려 감독이 대신 쓴다.
  readonly proposals: readonly {
    readonly name: string;
    readonly proposal: SceneBeatProposal | undefined;
  }[];
  // 지금까지 엮은 대목들. «[대목 n]» 머리를 단 채 이어져 있다.
  readonly priorPassages?: string;
  readonly grounding?: SceneGrounding;
  readonly design?: string;
  // 캐넌·이전 씬 맥락. 작가 참고용으로만 싣는다.
  readonly previousContext?: string;
  // 속마음 (속) 줄을 허락받은 시점 인물. 없으면 속마음을 쓰지 않는다.
  readonly innerCharacter?: string;
  readonly catchphraseLimit: number;
  readonly endState?: string;
  readonly retryReasons?: readonly string[];
  readonly style?: StyleDirective;
}

export interface SceneBeatPassage {
  // 첫 줄 «[선택: …]». 감독이 적지 않았으면 빈 문자열.
  readonly choice: string;
  readonly passage: string;
}

// NOTE: 감독은 뼈대 프롬프트의 규칙(좌표를 본문에 옮기지 않기·⟪⟫ 와 --- 는 파이프라인 몫·같은
// 화자는 한 문단)을 그대로 지고, 배우가 낸 것 밖의 사건을 짓지 않는다. 실측 1차에서 이 규칙이
// 빠지자 시각을 «시계는 오후 …»로 박고 연설형 턴을 문단으로 쪼갰다.
export const SceneBeatArbiterPrompt = {
  config: promptTuning('sceneBeatArbiter'),
  build(input: SceneBeatArbiterInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const style = input.style;
    const retryReasons = input.retryReasons ?? [];
    const grounding = sceneGroundingLines(input.grounding);

    return renderPrompt('sceneBeatArbiter', variant, {
      view: {
        hasGrounding: grounding.length > 0,
        design: input.design,
        previousContext: input.previousContext,
        priorPassages: input.priorPassages,
        innerCharacter: input.innerCharacter,
        catchphraseLimit: input.catchphraseLimit,
        endState: input.endState,
        hasRetryReasons: retryReasons.length > 0,
        retryReasons: retryReasons.join(' / '),
        proposals: input.proposals.map(({ name, proposal }) => ({
          name,
          proposal: proposal === undefined ? '(제안 없음)' : JSON.stringify(proposal, null, 1),
        })),
      },
      partials: {
        grounding: grounding.join('\n'),
        beatDirective: renderBeatDirective(input.beat),
        nextBeats: renderNextBeats(input.nextBeats),
        proseConventions: proseConventionLines(style?.narration?.tense).join('\n'),
        voiceStyle: (style
          ? [...narrationStyleLines(style.narration), ...voiceStyleLines(style)]
          : []
        ).join('\n'),
      },
    });
  },
} as const;

export function splitBeatPassage(response: string): SceneBeatPassage {
  const [first = '', ...rest] = response.trim().split('\n');

  return first.startsWith('[선택')
    ? { choice: first.trim(), passage: rest.join('\n').trim() }
    : { choice: '', passage: response.trim() };
}

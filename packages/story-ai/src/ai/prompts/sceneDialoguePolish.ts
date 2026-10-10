import {
  proseConventionLines,
  voiceStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

// 한 호출이 손보는 인물. 그 인물의 페르소나·입버릇·말투 표본·아는 것만 실린다 — 다른 인물의 것은
// 이 호출이 알 필요가 없고, 알면 그 인물이 모르는 사실이 대사로 샌다.
export interface SceneDialoguePolishCharacter {
  readonly name: string;
  readonly persona: string;
  readonly catchphrases?: readonly string[];
  // 인물이 앞선 씬에서 실제로 한 말. 말투 기준점이며 프롬프트에 없으면 카드 예시 대사만 남는다.
  readonly samples?: readonly string[];
  readonly knowledge?: readonly string[];
  // 상대별 말투("지훈에게: 반말"). 카드 relations 의 speech 에서 온다.
  readonly speechToOthers?: readonly string[];
  // 앞선 장면에서 바뀐 관계·호칭·말투(원장의 관계 항목). 상대별 말투보다 나중 상태다.
  readonly relationChanges?: readonly string[];
}

export interface SceneDialoguePolishInput {
  // 따옴표 대사마다 앞에 ⟨n⟩ 번호를 단 뼈대. 번호가 병합의 열쇠다.
  readonly numberedSkeleton: string;
  readonly character: SceneDialoguePolishCharacter;
  readonly otherCharacters: readonly string[];
  // 다른 인물 이름 → 그 인물 말투 한 줄(카드 voice 의 첫 줄). 이 인물이 그들을 닮지 않게 하려는 대비
  // 재료라, 페르소나·아는 것은 싣지 않는다(#104).
  readonly otherVoices?: Readonly<Record<string, string>>;
  // 이 인물의 지난 응답이 반려된 이유. 재호출에서만 있다.
  readonly retryReasons?: readonly string[];
  readonly style?: StyleDirective;
}

export interface SceneDialogueRewrite {
  readonly index: number;
  readonly text: string;
}

export interface SceneDialoguePolishResult {
  readonly rewrites: readonly SceneDialogueRewrite[];
  // 출력 한도에서 잘린 응답. 잘린 JSON 은 읽히지 않으므로 손본 대사가 비거나 모자란다.
  readonly isTruncated: boolean;
}

// NOTE: 뼈대는 사건 배치와 대사 작성을 한꺼번에 하느라 말투가 뭉개진다. 그래서 살붙임 전에 대사의
// 말투만 손보는 단계를 두되, 인물 하나에 호출 하나다. 다섯 페르소나를 한 호출에서 보면 모델이 평균을
// 내고, 각 호출이 자기 인물이 아는 것만 받으면 지식 경계가 지시문이 아니라 구조가 된다. 턴을 늘리는
// 것은 이 단계의 일이 아니다 — 대화 밀도는 뼈대 단계가 책임진다.
export const SceneDialoguePolishPrompt = {
  config: promptTuning('sceneDialoguePolish'),
  build(input: SceneDialoguePolishInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const voiceStyle = voiceStyleLines(input.style);
    const character = input.character;
    const list = (items: readonly string[] | undefined): readonly string[] => items ?? [];

    return renderPrompt('sceneDialoguePolish', variant, {
      view: {
        hasVoiceStyle: voiceStyle.length > 0,
        name: character.name,
        persona: character.persona,
        hasCatchphrases: list(character.catchphrases).length > 0,
        catchphrases: list(character.catchphrases),
        hasSamples: list(character.samples).length > 0,
        samples: list(character.samples),
        hasKnowledge: list(character.knowledge).length > 0,
        knowledge: list(character.knowledge),
        hasSpeechToOthers: list(character.speechToOthers).length > 0,
        speechToOthers: list(character.speechToOthers),
        hasRelationChanges: list(character.relationChanges).length > 0,
        relationChanges: list(character.relationChanges),
        hasOtherCharacters: input.otherCharacters.length > 0,
        hasOtherVoices: input.otherCharacters.some((name) => input.otherVoices?.[name] !== undefined),
        otherCharacters: input.otherCharacters
          .map((name) => {
            const voice = input.otherVoices?.[name];
            return voice === undefined ? `- ${name}` : `- ${name}: ${voice}`;
          })
          .join('\n'),
        numberedSkeleton: input.numberedSkeleton,
        hasRetryReasons: list(input.retryReasons).length > 0,
        retryReasons: list(input.retryReasons).join(' / '),
      },
      partials: {
        proseConventions: proseConventionLines(input.style?.narration?.tense).join('\n'),
        voiceStyle: voiceStyle.join('\n'),
      },
    });
  },
} as const;

// 번호가 양의 정수이고 문장이 비어 있지 않은 항목만 남긴다. 같은 번호가 두 번 오면 앞 것을 쓴다.
export function coerceDialogueRewrites(parsed: readonly unknown[] | null): SceneDialogueRewrite[] {
  if (parsed === null) {
    return [];
  }

  const seen = new Set<number>();
  const rewrites: SceneDialogueRewrite[] = [];

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const index = typeof record.n === 'number' ? record.n : Number(record.n);
    const text = typeof record.text === 'string' ? record.text.trim() : '';

    if (!Number.isInteger(index) || index <= 0 || text.length === 0 || seen.has(index)) {
      continue;
    }

    seen.add(index);
    rewrites.push({ index, text });
  }

  return rewrites;
}

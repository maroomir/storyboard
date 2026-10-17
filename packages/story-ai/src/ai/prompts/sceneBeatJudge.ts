import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';
import {
  renderBeatCharacterBlock,
  renderBeatDirective,
  renderNextBeats,
  type SceneBeatCharacter,
  type SceneBeatDirective,
} from './sceneBeatBlocks';

export interface SceneBeatJudgeInput {
  readonly characters: readonly SceneBeatCharacter[];
  readonly beat: SceneBeatDirective;
  readonly nextBeats: readonly SceneBeatDirective[];
  readonly previousPassages?: string;
  readonly passage: string;
}

export interface SceneBeatScore {
  readonly name: string;
  readonly score: number;
  readonly reason: string;
  // 다음 대목에서 피할 행동 한 줄. 따옴표가 들어 있으면 대사 지시이므로 호출자가 버린다.
  readonly avoid: string;
}

export interface SceneBeatVerdict {
  readonly scores: readonly SceneBeatScore[];
  readonly isBeatCovered: boolean;
  readonly beatMissing: string;
  readonly earlyMaterial: string;
  readonly repeats: string;
}

// NOTE: 심판은 평가만 한다. 1차 실측에서 «고칠 대사»를 받아 다음 대목에 넘기자 배우가 그 문구를
// 받아쓰며 입버릇이 틱으로 증폭됐다(보상 해킹). 그래서 출력은 점수·이유·피할 행동뿐이다.
export const SceneBeatJudgePrompt = {
  config: promptTuning('sceneBeatJudge'),
  build(input: SceneBeatJudgeInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('sceneBeatJudge', variant, {
      view: {
        previousPassages: input.previousPassages,
        passage: input.passage,
        names: input.characters.map((character) => character.name).join(', '),
      },
      partials: {
        characterBlocks: input.characters
          .map((character) =>
            [
              renderBeatCharacterBlock(character),
              `[이 인물이 지금까지 겪은 일]\n${character.witnessed ?? '(없음)'}`,
            ].join('\n\n'),
          )
          .join('\n\n'),
        beatDirective: renderBeatDirective(input.beat),
        nextBeats: renderNextBeats(input.nextBeats),
      },
    });
  },
} as const;

// 점수가 0~5 의 정수인 항목만 남긴다. 심판이 이름을 빠뜨린 인물은 채점되지 않은 것이다.
export function coerceBeatVerdict(
  parsed: Record<string, unknown> | null,
): SceneBeatVerdict | undefined {
  if (parsed === null || !Array.isArray(parsed.scores)) {
    return undefined;
  }

  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const scores = parsed.scores.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const score = typeof record.score === 'number' ? record.score : Number(record.score);
    const name = text(record.name);

    return name.length === 0 || !Number.isInteger(score) || score < 0 || score > 5
      ? []
      : [{ name, score, reason: text(record.reason), avoid: text(record.avoid) }];
  });

  return {
    scores,
    isBeatCovered: parsed.beatCovered !== false,
    beatMissing: text(parsed.beatMissing),
    earlyMaterial: text(parsed.earlyMaterial),
    repeats: text(parsed.repeats),
  };
}

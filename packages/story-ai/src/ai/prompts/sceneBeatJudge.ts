import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
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
  readonly avoid: string;
}

export interface SceneBeatVerdict {
  readonly scores: readonly SceneBeatScore[];
  readonly isBeatCovered: boolean;
  readonly beatMissing: string;
  readonly earlyMaterial: string;
  readonly repeats: string;
}

export const SceneBeatJudgePrompt: PromptModule<
  [input: SceneBeatJudgeInput, variant?: PromptVariantId]
> = {
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
};

export function coerceBeatVerdict(
  parsed: Record<string, unknown> | null,
): SceneBeatVerdict | undefined {
  if (parsed === null || !Array.isArray(parsed.scores)) {
    return undefined;
  }

  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const scores: SceneBeatScore[] = parsed.scores.flatMap((entry): SceneBeatScore[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const score: number = typeof record.score === 'number' ? record.score : Number(record.score);
    const name: string = text(record.name);

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

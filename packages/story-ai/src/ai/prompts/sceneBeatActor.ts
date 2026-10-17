import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';
import {
  renderBeatCharacterBlock,
  renderBeatDirective,
  renderNextBeats,
  stringList,
  type SceneBeatCharacter,
  type SceneBeatDirective,
} from './sceneBeatBlocks';

export interface SceneBeatActorInput {
  readonly character: SceneBeatCharacter;
  readonly beat: SceneBeatDirective;
  readonly nextBeats: readonly SceneBeatDirective[];
  readonly lineMaxChars: number;
  readonly lineMaxSentences: number;
  // 앞 제안에서 상한을 넘긴 대사. 재호출에서만 있다.
  readonly overlongLines?: readonly string[];
}

export interface SceneBeatProposalOption {
  readonly strategy: string;
  readonly action: string;
  readonly lines: readonly string[];
}

export interface SceneBeatProposal {
  readonly inner: string;
  readonly options: readonly SceneBeatProposalOption[];
}

// NOTE: 배우는 자기 인물만 받는다 — 페르소나·입버릇·상대별 말투·아는 것과, 이 장면에서 자기가 본
// 대목. 다른 인물의 속마음과 자기가 없던 자리의 일은 프롬프트에 없으므로 «모르는 것을 말하는»
// 경계 위반이 지시문이 아니라 구조로 막힌다. 선택지를 둘 내게 하는 것은 감독이 고를 여지를 두기
// 위해서다.
export const SceneBeatActorPrompt = {
  config: promptTuning('sceneBeatActor'),
  build(input: SceneBeatActorInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const overlongLines = input.overlongLines ?? [];

    return renderPrompt('sceneBeatActor', variant, {
      view: {
        lineMaxChars: input.lineMaxChars,
        lineMaxSentences: input.lineMaxSentences,
        hasOverlongLines: overlongLines.length > 0,
        overlongLines,
        witnessed: input.character.witnessed,
      },
      partials: {
        characterBlock: renderBeatCharacterBlock(input.character),
        beatDirective: renderBeatDirective(input.beat),
        nextBeats: renderNextBeats(input.nextBeats),
      },
    });
  },
} as const;

// 선택지가 하나도 서지 않으면 제안이 없는 것으로 본다. 대사가 없는 선택지는 행동만으로도 선다.
export function coerceBeatProposal(
  parsed: Record<string, unknown> | null,
): SceneBeatProposal | undefined {
  if (parsed === null) {
    return undefined;
  }

  const options = (Array.isArray(parsed.options) ? parsed.options : []).flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const strategy = typeof record.strategy === 'string' ? record.strategy.trim() : '';
    const action = typeof record.action === 'string' ? record.action.trim() : '';
    const lines = stringList(record.lines);

    return action.length === 0 && lines.length === 0 ? [] : [{ strategy, action, lines }];
  });

  if (options.length === 0) {
    return undefined;
  }

  return { inner: typeof parsed.inner === 'string' ? parsed.inner.trim() : '', options };
}

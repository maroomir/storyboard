import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
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

export const SceneBeatActorPrompt: PromptModule<
  [input: SceneBeatActorInput, variant?: PromptVariantId]
> = {
  config: promptTuning('sceneBeatActor'),
  build(input: SceneBeatActorInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const overlongLines: readonly string[] = input.overlongLines ?? [];

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
};

export function coerceBeatProposal(
  parsed: Record<string, unknown> | null,
): SceneBeatProposal | undefined {
  if (parsed === null) {
    return undefined;
  }

  const options: SceneBeatProposalOption[] = (
    Array.isArray(parsed.options) ? parsed.options : []
  ).flatMap((entry): SceneBeatProposalOption[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const strategy: string = typeof record.strategy === 'string' ? record.strategy.trim() : '';
    const action: string = typeof record.action === 'string' ? record.action.trim() : '';
    const lines: string[] = stringList(record.lines);

    return action.length === 0 && lines.length === 0 ? [] : [{ strategy, action, lines }];
  });

  if (options.length === 0) {
    return undefined;
  }

  return { inner: typeof parsed.inner === 'string' ? parsed.inner.trim() : '', options };
}

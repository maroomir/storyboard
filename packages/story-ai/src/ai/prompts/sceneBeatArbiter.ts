import {
  narrationStyleLines,
  proseConventionLines,
  sceneGroundingLines,
  voiceStyleLines,
  type SceneGrounding,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from './types';
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
  readonly proposals: readonly {
    readonly name: string;
    readonly proposal: SceneBeatProposal | undefined;
  }[];
  readonly priorPassages?: string;
  readonly grounding?: SceneGrounding;
  readonly design?: string;
  readonly previousContext?: string;
  readonly innerCharacter?: string;
  readonly catchphraseLimit: number;
  readonly endState?: string;
  readonly retryReasons?: readonly string[];
  readonly style?: StyleDirective;
}

export interface SceneBeatPassage {
  readonly choice: string;
  readonly passage: string;
}

export const SceneBeatArbiterPrompt: PromptModule<[input: SceneBeatArbiterInput, variant?: PromptVariantId]> = {
  config: promptTuning('sceneBeatArbiter'),
  build(input: SceneBeatArbiterInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const style: StyleDirective | undefined = input.style;
    const retryReasons: readonly string[] = input.retryReasons ?? [];
    const grounding: string[] = sceneGroundingLines(input.grounding);

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
};

export function splitBeatPassage(response: string): SceneBeatPassage {
  const [first = '', ...rest] = response.trim().split('\n');

  return first.startsWith('[선택')
    ? { choice: first.trim(), passage: rest.join('\n').trim() }
    : { choice: '', passage: response.trim() };
}

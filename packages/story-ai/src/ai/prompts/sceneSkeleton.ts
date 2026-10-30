import type { Background, SceneGrounding } from '@storyboard/story-model';
import {
  joinCardText,
  craftContractLines,
  narrationStyleLines,
  proseConventionLines,
  sceneGroundingLines,
  voiceStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { personaCatchphraseView } from '#ai/ai/prompts/characterCatchphrases';
import { personaKnowledgeView } from '#ai/ai/prompts/characterKnowledge';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface SceneSkeletonInput {
  readonly narrativeSource: string;
  readonly design?: string;
  readonly personas: ReadonlyMap<string, string>;
  readonly catchphrases?: ReadonlyMap<string, readonly string[]>;
  readonly characterKnowledge?: ReadonlyMap<string, readonly string[]>;
  readonly background: Background;
  readonly backgroundConflicts?: readonly string[];
  readonly previousContext?: string;
  readonly endState?: string;
  readonly grounding?: SceneGrounding;
  readonly style?: StyleDirective;
  readonly targetLength?: number;
  readonly retryReasons?: readonly string[];
  readonly plannedBreaks?: boolean;
  readonly priorSkeleton?: string;
  readonly nextBeat?: string;
}

export const SceneSkeletonPrompt: PromptModule<
  [input: SceneSkeletonInput, variant?: PromptVariantId]
> = {
  config: promptTuning('sceneSkeleton'),
  build(input: SceneSkeletonInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const style: StyleDirective | undefined = input.style;

    return renderPrompt('sceneSkeleton', variant, {
      view: {
        targetLength: input.targetLength ? input.targetLength.toLocaleString() : undefined,
        design: input.design,
        endState: input.endState,
        hasRetryReasons: input.retryReasons !== undefined && input.retryReasons.length > 0,
        retryReasons: input.retryReasons?.join(' / '),
        priorSkeleton: input.priorSkeleton,
        nextBeat: input.nextBeat,
        backgroundDescription: joinCardText(input.background.description),
        hasBackgroundConflicts: (input.backgroundConflicts ?? []).length > 0,
        backgroundConflicts: input.backgroundConflicts ?? [],
        hasPersonas: input.personas.size > 0,
        personas: Array.from(input.personas.entries()).map(([name, persona]) => ({
          name,
          persona,
          ...personaCatchphraseView(name, input.catchphrases),
          ...personaKnowledgeView(name, input.characterKnowledge),
        })),
        previousContext: input.previousContext,
        narrativeSource: input.narrativeSource,
        plannedBreaks: input.plannedBreaks === true,
      },
      partials: {
        proseConventions: proseConventionLines(style?.narration?.tense).join('\n'),
        voiceStyle: (style
          ? [...narrationStyleLines(style.narration), ...voiceStyleLines(style)]
          : []
        ).join('\n'),
        craftContract: craftContractLines(style?.craftContract).join('\n'),
        grounding: sceneGroundingLines(input.grounding).join('\n'),
      },
    });
  },
};

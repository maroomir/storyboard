import {
  craftContractLines,
  proseConventionLines,
  narrativeStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface SceneSectionExpansionInput {
  readonly skeleton: string;
  readonly section: string;
  readonly previousSection?: string;
  readonly targetLength: number;
  readonly backgroundFacts?: readonly string[];
  readonly backgroundConflicts?: readonly string[];
  readonly sceneCoordinates?: readonly string[];
  readonly retryReasons?: readonly string[];
  readonly isUnderLengthRetry?: boolean;
  readonly style?: StyleDirective;
}

export const SceneSectionExpansionPrompt: PromptModule<
  [input: SceneSectionExpansionInput, variant?: PromptVariantId]
> = {
  config: promptTuning('sceneSectionExpansion'),
  build(input: SceneSectionExpansionInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('sceneSectionExpansion', variant, {
      view: {
        targetLength: input.targetLength.toLocaleString(),
        hasRetryReasons: input.retryReasons !== undefined && input.retryReasons.length > 0,
        retryReasons: input.retryReasons?.join(' / '),
        isUnderLengthRetry: input.isUnderLengthRetry === true,
        hasBackgroundFacts: (input.backgroundFacts ?? []).length > 0,
        backgroundFacts: input.backgroundFacts ?? [],
        hasBackgroundConflicts: (input.backgroundConflicts ?? []).length > 0,
        backgroundConflicts: input.backgroundConflicts ?? [],
        hasSceneCoordinates: (input.sceneCoordinates ?? []).length > 0,
        sceneCoordinates: input.sceneCoordinates ?? [],
        skeleton: input.skeleton,
        previousSection: input.previousSection,
        section: input.section,
      },
      partials: {
        proseConventions: proseConventionLines(input.style?.narration?.tense).join('\n'),
        narrativeStyle: narrativeStyleLines(stripLength(input.style)).join('\n'),
        craftContract: craftContractLines(input.style?.craftContract).join('\n'),
      },
    });
  },
};

function stripLength(style: StyleDirective | undefined): StyleDirective | undefined {
  if (!style || style.targetWordCount === undefined) {
    return style;
  }

  const { targetWordCount: _unused, ...rest } = style;
  return rest;
}

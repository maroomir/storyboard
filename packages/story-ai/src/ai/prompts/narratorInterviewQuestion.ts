import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import {
  narratorView,
  promptListText,
  type NarratorInterviewVoice,
} from '#ai/ai/prompts/narratorInterviewVoice';

export interface NarratorInterviewQuestionInput {
  readonly narrator: NarratorInterviewVoice;
  readonly sceneTitle: string;
  readonly situation: string;
  readonly priorAnswers: readonly string[];
  readonly optionCount: number;
}

export interface NarratorInterviewQuestionDraft {
  readonly question: string;
  readonly options: readonly string[];
}

export const NarratorInterviewQuestionPrompt: PromptModule<
  [input: NarratorInterviewQuestionInput, variant?: PromptVariantId]
> = {
  config: promptTuning('narratorInterviewQuestion'),
  build(input: NarratorInterviewQuestionInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('narratorInterviewQuestion', variant, {
      view: {
        ...narratorView(input.narrator),
        sceneTitle: input.sceneTitle,
        situation: input.situation,
        hasPriorAnswers: input.priorAnswers.length > 0,
        priorAnswers: input.priorAnswers,
        optionCount: input.optionCount,
      },
    });
  },
};

const minimumOptionCount: number = 2;

export function coerceNarratorInterviewQuestion(
  parsed: Record<string, unknown> | null,
): NarratorInterviewQuestionDraft | undefined {
  if (parsed === null) {
    return undefined;
  }

  const question: string = typeof parsed.question === 'string' ? parsed.question.trim() : '';
  const options: string[] = [
    ...new Set((Array.isArray(parsed.options) ? parsed.options : []).map(promptListText).filter((text) => text.length > 0)),
  ];

  return question.length === 0 || options.length < minimumOptionCount ? undefined : { question, options };
}

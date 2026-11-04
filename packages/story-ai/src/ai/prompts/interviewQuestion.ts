import type { BibleSubjectKind, InterviewAxis } from '@storyboard/story-model';

import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface InterviewQuestionInput {
  readonly cardType: BibleSubjectKind;
  readonly name: string;
  readonly genre?: string;
  readonly summary: string;
  readonly relationSpeech: readonly string[];
  readonly axes: readonly InterviewQuestionAxis[];
  readonly situation: string;
  readonly isOffBeat: boolean;
  readonly priorAnswers: readonly string[];
  readonly optionCount: number;
  readonly shouldExplore: boolean;
}

export interface InterviewQuestionAxis extends InterviewAxis {
  readonly unseenValueIds: readonly string[];
}

export interface InterviewQuestionDraft {
  readonly axisId: string;
  readonly question: string;
  readonly options: readonly { readonly valueId: string; readonly text: string }[];
}

export const InterviewQuestionPrompt: PromptModule<
  [input: InterviewQuestionInput, variant?: PromptVariantId]
> = {
  config: promptTuning('interviewQuestion'),
  build(input: InterviewQuestionInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('interviewQuestion', variant, {
      view: {
        isBackground: input.cardType === 'background',
        name: input.name,
        genre: input.genre,
        summary: input.summary,
        hasRelationSpeech: input.relationSpeech.length > 0,
        relationSpeech: input.relationSpeech,
        axes: input.axes.map((axis) => ({
          id: axis.id,
          label: axis.label,
          values: axis.values.map((value) => ({
            id: value.id,
            label: value.label,
            isUnseen: axis.unseenValueIds.includes(value.id),
          })),
        })),
        hasPriorAnswers: input.priorAnswers.length > 0,
        priorAnswers: input.priorAnswers,
        situation: input.situation,
        isOffBeat: input.isOffBeat,
        optionCount: input.optionCount,
        shouldExplore: input.shouldExplore,
      },
    });
  },
};

export function coerceInterviewQuestion(
  parsed: Record<string, unknown> | null,
  axes: readonly InterviewAxis[],
): InterviewQuestionDraft | undefined {
  if (parsed === null) {
    return undefined;
  }

  const axisId: string = typeof parsed.axisId === 'string' ? parsed.axisId.trim() : '';
  const axis: InterviewAxis | undefined =
    axes.find((candidate) => candidate.id === axisId) ?? (axes.length === 1 ? axes[0] : undefined);
  if (axis === undefined) {
    return undefined;
  }

  const question: string = typeof parsed.question === 'string' ? parsed.question.trim() : '';
  const knownValueIds: Set<string> = new Set(axis.values.map((value) => value.id));
  const seen: Set<string> = new Set<string>();
  const options: { readonly valueId: string; readonly text: string }[] = (
    Array.isArray(parsed.options) ? parsed.options : []
  ).flatMap((entry): { readonly valueId: string; readonly text: string }[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const valueId: string = typeof record.valueId === 'string' ? record.valueId.trim() : '';
    const text: string = typeof record.text === 'string' ? record.text.trim() : '';
    const isUsable: boolean =
      knownValueIds.has(valueId) && !seen.has(valueId) && text.length > 0;
    seen.add(valueId);

    return isUsable ? [{ valueId, text }] : [];
  });

  return question.length === 0 || options.length < 2
    ? undefined
    : { axisId: axis.id, question, options };
}

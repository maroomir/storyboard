import type { BibleSubjectKind, InterviewAxis } from '@storyboard/story-model';

import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface InterviewCardAnswersInput {
  readonly cardType: BibleSubjectKind;
  readonly name: string;
  readonly cardText: string;
  readonly axes: readonly InterviewAxis[];
}

export const InterviewCardAnswersPrompt: PromptModule<
  [input: InterviewCardAnswersInput, variant?: PromptVariantId]
> = {
  config: promptTuning('interviewCardAnswers'),
  build(input: InterviewCardAnswersInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('interviewCardAnswers', variant, {
      view: {
        isBackground: input.cardType === 'background',
        name: input.name,
        cardText: input.cardText,
        axes: input.axes.map((axis) => ({
          id: axis.id,
          label: axis.label,
          values: axis.values.map((value) => ({ id: value.id, label: value.label })),
        })),
      },
    });
  },
};

function readAnswerPair(entry: unknown): readonly [axisId: string, valueId: string] | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }

  const record: Record<string, unknown> = entry as Record<string, unknown>;
  const axisId: string = typeof record.axisId === 'string' ? record.axisId.trim() : '';
  const valueId: string = typeof record.valueId === 'string' ? record.valueId.trim() : '';

  return [axisId, valueId];
}

export function coerceInterviewCardAnswers(
  parsed: Record<string, unknown> | null,
  axes: readonly InterviewAxis[],
): Record<string, string> {
  const valueIdByAxis: Record<string, string> = {};

  for (const entry of Array.isArray(parsed?.answers) ? parsed.answers : []) {
    const pair: readonly [string, string] | undefined = readAnswerPair(entry);
    const axis: InterviewAxis | undefined = axes.find((candidate) => candidate.id === pair?.[0]);
    const isKnownValue: boolean = axis?.values.some((value) => value.id === pair?.[1]) ?? false;
    if (pair !== undefined && isKnownValue && valueIdByAxis[pair[0]] === undefined) {
      valueIdByAxis[pair[0]] = pair[1];
    }
  }

  return valueIdByAxis;
}

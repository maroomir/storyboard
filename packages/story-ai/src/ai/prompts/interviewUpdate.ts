import type { BibleSubjectKind, InterviewAxis } from '@storyboard/story-model';

import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface InterviewUpdateInput {
  readonly cardType: BibleSubjectKind;
  readonly name: string;
  readonly summary: string;
  readonly axis: InterviewAxis;
  readonly situation: string;
  readonly question: string;
  readonly options: readonly { readonly valueId: string; readonly text: string }[];
  readonly answer: string;
  readonly isWritten: boolean;
  readonly rebuild?: { readonly cardText: string; readonly records: readonly string[] };
}

export type InterviewClassificationDraft =
  | { readonly kind: 'value'; readonly valueId: string }
  | { readonly kind: 'newValue'; readonly id: string; readonly label: string };

export interface InterviewUpdateDraft {
  readonly summary: string;
  readonly classification?: InterviewClassificationDraft;
}

const valueIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export const InterviewUpdatePrompt: PromptModule<
  [input: InterviewUpdateInput, variant?: PromptVariantId]
> = {
  config: promptTuning('interviewUpdate'),
  build(input: InterviewUpdateInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('interviewUpdate', variant, {
      view: {
        isBackground: input.cardType === 'background',
        isRebuild: input.rebuild !== undefined,
        isWritten: input.isWritten,
        name: input.name,
        cardText: input.rebuild?.cardText,
        summary: input.summary,
        axisLabel: input.axis.label,
        values: input.axis.values.map((value) => ({ id: value.id, label: value.label })),
        situation: input.situation,
        question: input.question,
        options: input.options,
        answer: input.answer,
        hasRecords: (input.rebuild?.records.length ?? 0) > 0,
        records: input.rebuild?.records ?? [],
      },
    });
  },
};

function coerceClassification(
  value: unknown,
  axis: InterviewAxis,
): InterviewClassificationDraft | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const valueId: string = typeof record.valueId === 'string' ? record.valueId.trim() : '';
  if (axis.values.some((axisValue) => axisValue.id === valueId)) {
    return { kind: 'value', valueId };
  }

  const newValue: Record<string, unknown> | undefined =
    typeof record.newValue === 'object' && record.newValue !== null
      ? (record.newValue as Record<string, unknown>)
      : undefined;
  const id: string = typeof newValue?.id === 'string' ? newValue.id.trim().toLowerCase() : '';
  const label: string = typeof newValue?.label === 'string' ? newValue.label.trim() : '';
  const isNewValueUsable: boolean =
    valueIdPattern.test(id) && label.length > 0 && !axis.values.some((axisValue) => axisValue.id === id);

  return isNewValueUsable ? { kind: 'newValue', id, label } : undefined;
}

export function coerceInterviewUpdate(
  parsed: Record<string, unknown> | null,
  axis: InterviewAxis,
): InterviewUpdateDraft | undefined {
  if (parsed === null) {
    return undefined;
  }

  const summary: string = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (summary.length === 0) {
    return undefined;
  }

  const classification: InterviewClassificationDraft | undefined = coerceClassification(
    parsed.classification,
    axis,
  );

  return classification === undefined ? { summary } : { summary, classification };
}

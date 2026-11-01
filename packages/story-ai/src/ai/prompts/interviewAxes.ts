import type { BibleSubjectKind, InterviewAxis } from '@storyboard/story-model';

import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface InterviewAxesInput {
  readonly cardType: BibleSubjectKind;
  readonly genre?: string;
  readonly audience?: string;
  readonly concept?: string;
  readonly synopsis?: string;
  readonly prohibitions: readonly string[];
  readonly existingAxes: readonly InterviewAxis[];
  readonly beats: readonly string[];
  readonly maxAxes: number;
}

const cardTypeLabels: Readonly<Record<BibleSubjectKind, string>> = {
  character: '인물',
  background: '배경(장소)',
};

const axisIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export const InterviewAxesPrompt: PromptModule<[input: InterviewAxesInput, variant?: PromptVariantId]> = {
  config: promptTuning('interviewAxes'),
  build(input: InterviewAxesInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('interviewAxes', variant, {
      view: {
        isBackground: input.cardType === 'background',
        cardTypeLabel: cardTypeLabels[input.cardType],
        genre: input.genre,
        audience: input.audience,
        concept: input.concept,
        synopsis: input.synopsis,
        hasProhibitions: input.prohibitions.length > 0,
        prohibitions: input.prohibitions.join(' / '),
        hasExisting: input.existingAxes.length > 0,
        existingAxes: input.existingAxes.map((axis) => ({
          id: axis.id,
          label: axis.label,
          values: axis.values.map((value) => value.label).join(' / '),
        })),
        hasBeats: input.beats.length > 0,
        beats: input.beats,
        maxAxes: input.maxAxes,
      },
    });
  },
};

function coerceAxisId(value: unknown): string | undefined {
  const id: string = typeof value === 'string' ? value.trim().toLowerCase() : '';

  return axisIdPattern.test(id) ? id : undefined;
}

export function coerceInterviewAxes(parsed: Record<string, unknown> | null): InterviewAxis[] {
  const entries: unknown[] = Array.isArray(parsed?.axes) ? parsed.axes : [];

  return entries.flatMap((entry): InterviewAxis[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const id: string | undefined = coerceAxisId(record.id);
    const label: string = typeof record.label === 'string' ? record.label.trim() : '';
    const values: { readonly id: string; readonly label: string }[] = (
      Array.isArray(record.values) ? record.values : []
    ).flatMap((valueEntry): { readonly id: string; readonly label: string }[] => {
      if (typeof valueEntry !== 'object' || valueEntry === null) {
        return [];
      }

      const valueRecord: Record<string, unknown> = valueEntry as Record<string, unknown>;
      const valueId: string | undefined = coerceAxisId(valueRecord.id);
      const valueLabel: string =
        typeof valueRecord.label === 'string' ? valueRecord.label.trim() : '';

      return valueId === undefined || valueLabel.length === 0 ? [] : [{ id: valueId, label: valueLabel }];
    });
    const uniqueValues: { readonly id: string; readonly label: string }[] = values.filter(
      (value, index) => values.findIndex((other) => other.id === value.id) === index,
    );

    return id === undefined || label.length === 0 || uniqueValues.length < 2
      ? []
      : [{ id, label, values: uniqueValues }];
  });
}


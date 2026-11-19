import { coerceStringList, type BibleSubjectKind, type InterviewDistillExclusion } from '@storyboard/story-model';

import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface InterviewDistillInput {
  readonly cardType: BibleSubjectKind;
  readonly name: string;
  readonly cardText: string;
  readonly existingLines: readonly string[];
  readonly summary: string;
  readonly tallies: readonly string[];
  readonly choices: readonly string[];
  readonly written: readonly string[];
  readonly relationTargets: readonly string[];
  readonly minimumWeight: number;
}

export interface InterviewRelationSpeechDraft {
  readonly target: string;
  readonly speech: string;
}

export interface InterviewDistillDraft {
  readonly traits: readonly string[];
  readonly voice: readonly string[];
  readonly desire: readonly string[];
  readonly description: readonly string[];
  readonly relationSpeech: readonly InterviewRelationSpeechDraft[];
  readonly layout: readonly string[];
  readonly rules: readonly string[];
  readonly senses: readonly string[];
  readonly coveredValues: readonly string[];
  readonly excluded: readonly InterviewDistillExclusion[];
}

export const InterviewDistillPrompt: PromptModule<
  [input: InterviewDistillInput, variant?: PromptVariantId]
> = {
  config: promptTuning('interviewDistill'),
  build(input: InterviewDistillInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('interviewDistill', variant, {
      view: {
        isBackground: input.cardType === 'background',
        name: input.name,
        cardText: input.cardText,
        hasExistingLines: input.existingLines.length > 0,
        existingLines: input.existingLines,
        summary: input.summary,
        tallies: input.tallies,
        hasChoices: input.choices.length > 0,
        choices: input.choices,
        hasWritten: input.written.length > 0,
        written: input.written,
        hasRelationTargets: input.relationTargets.length > 0,
        relationTargets: input.relationTargets,
        minimumWeight: input.minimumWeight,
      },
    });
  },
};

function coerceRelationSpeech(
  value: unknown,
  relationTargets: readonly string[],
): InterviewRelationSpeechDraft[] {
  return (Array.isArray(value) ? value : []).flatMap((entry): InterviewRelationSpeechDraft[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const target: string = typeof record.target === 'string' ? record.target.trim() : '';
    const speech: string = typeof record.speech === 'string' ? record.speech.trim() : '';
    const isUsable: boolean = relationTargets.includes(target) && speech.length > 0;

    return isUsable ? [{ target, speech }] : [];
  });
}

function readOptionalText(value: unknown): string | undefined {
  const text: string = typeof value === 'string' ? value.trim() : '';

  return text.length === 0 ? undefined : text;
}

function coerceExclusions(value: unknown): InterviewDistillExclusion[] {
  return (Array.isArray(value) ? value : []).flatMap((entry): InterviewDistillExclusion[] => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const excludedValue: string | undefined = readOptionalText(record.value);
    const existingLine: string | undefined = readOptionalText(record.existingLine);
    const note: string | undefined = readOptionalText(record.note);

    return excludedValue === undefined
      ? []
      : [
          {
            value: excludedValue,
            ...(existingLine === undefined ? {} : { existingLine }),
            ...(note === undefined ? {} : { note }),
          },
        ];
  });
}

function coerceCoveredValues(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).flatMap((entry): string[] => {
    const coveredValue: string | undefined =
      typeof entry === 'object' && entry !== null ? readOptionalText((entry as Record<string, unknown>).value) : undefined;

    return coveredValue === undefined ? [] : [coveredValue];
  });
}

export function coerceInterviewDistill(
  parsed: Record<string, unknown> | null,
  relationTargets: readonly string[],
): InterviewDistillDraft {
  return {
    traits: coerceStringList(parsed?.traits),
    voice: coerceStringList(parsed?.voice),
    desire: coerceStringList(parsed?.desire),
    description: coerceStringList(parsed?.description),
    relationSpeech: coerceRelationSpeech(parsed?.relationSpeech, relationTargets),
    layout: coerceStringList(parsed?.layout),
    rules: coerceStringList(parsed?.rules),
    senses: coerceStringList(parsed?.senses),
    coveredValues: coerceCoveredValues(parsed?.covered),
    excluded: coerceExclusions(parsed?.excluded),
  };
}

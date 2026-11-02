import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface InterviewRelationSpeechInput {
  readonly name: string;
  readonly catchphrases: readonly string[];
  readonly targetId: string;
  readonly targetName: string;
  readonly targetAliases: readonly string[];
  readonly currentSpeech?: string;
  readonly scenes: readonly string[];
  readonly optionCount: number;
}

export interface InterviewRelationSpeechQuestion {
  readonly question: string;
  readonly options: readonly string[];
}

export const InterviewRelationSpeechPrompt: PromptModule<
  [input: InterviewRelationSpeechInput, variant?: PromptVariantId]
> = {
  config: promptTuning('interviewRelationSpeech'),
  build(input: InterviewRelationSpeechInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('interviewRelationSpeech', variant, {
      view: {
        name: input.name,
        hasCatchphrases: input.catchphrases.length > 0,
        catchphrases: input.catchphrases,
        targetId: input.targetId,
        targetName: input.targetName,
        hasTargetAliases: input.targetAliases.length > 0,
        targetAliases: input.targetAliases,
        currentSpeech: input.currentSpeech,
        hasScenes: input.scenes.length > 0,
        scenes: input.scenes,
        optionCount: input.optionCount,
      },
    });
  },
};

export function coerceInterviewRelationSpeech(
  parsed: Record<string, unknown> | null,
): InterviewRelationSpeechQuestion | undefined {
  if (parsed === null) {
    return undefined;
  }

  const question: string = typeof parsed.question === 'string' ? parsed.question.trim() : '';
  const options: string[] = (Array.isArray(parsed.options) ? parsed.options : []).flatMap(
    (entry): string[] => {
      const text: string =
        typeof entry === 'object' && entry !== null && typeof (entry as { text?: unknown }).text === 'string'
          ? ((entry as { text: string }).text).trim()
          : typeof entry === 'string'
            ? entry.trim()
            : '';
      return text.length === 0 ? [] : [text];
    },
  );
  const unique: string[] = [...new Set(options)];

  return question.length === 0 || unique.length < 2 ? undefined : { question, options: unique };
}

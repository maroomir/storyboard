import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import {
  narratorView,
  promptListText,
  type NarratorInterviewVoice,
} from '#ai/ai/prompts/narratorInterviewVoice';

export interface NarratorInterviewAnswer {
  readonly situation: string;
  readonly answer: string;
}

export interface NarratorInterviewDistillInput {
  readonly narrator: NarratorInterviewVoice;
  readonly answers: readonly NarratorInterviewAnswer[];
}

export const NarratorInterviewDistillPrompt: PromptModule<
  [input: NarratorInterviewDistillInput, variant?: PromptVariantId]
> = {
  config: promptTuning('narratorInterviewDistill'),
  build(input: NarratorInterviewDistillInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('narratorInterviewDistill', variant, {
      view: {
        ...narratorView(input.narrator),
        answers: input.answers.map((entry) => ({ situation: entry.situation, answer: entry.answer })),
      },
    });
  },
};

export function coerceNarratorInterviewDistill(parsed: Record<string, unknown> | null): string[] {
  const voice: unknown = parsed?.voice;
  return Array.isArray(voice) ? [...new Set(voice.map(promptListText).filter((line) => line.length > 0))] : [];
}

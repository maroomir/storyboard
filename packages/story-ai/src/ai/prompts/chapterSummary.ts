import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { promptTuning } from '#ai/ai/prompts/promptTuning';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';

export interface ChapterSummaryInput {
  readonly chapterTitle: string;
  readonly body: string;
}

export const ChapterSummaryPrompt: PromptModule<
  [input: ChapterSummaryInput, variant?: PromptVariantId]
> = {
  config: promptTuning('chapterSummary'),
  build(input: ChapterSummaryInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('chapterSummary', variant, {
      view: { chapterTitle: input.chapterTitle, body: input.body },
    });
  },
};

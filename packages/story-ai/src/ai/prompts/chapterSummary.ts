import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

export interface ChapterSummaryInput {
  readonly chapterTitle: string;
  readonly body: string;
}

export const ChapterSummaryPrompt = {
  config: promptTuning('chapterSummary'),
  build(input: ChapterSummaryInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    return renderPrompt('chapterSummary', variant, {
      view: { chapterTitle: input.chapterTitle, body: input.body },
    });
  },
} as const;

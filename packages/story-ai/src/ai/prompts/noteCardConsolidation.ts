import type { NoteConsolidationTarget } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

function renderList(label: string, values: readonly string[]): string[] {
  return values.length === 0 ? [] : [`${label}:`, ...values.map((value) => `- ${value}`)];
}

function renderTarget(target: NoteConsolidationTarget): string {
  return [
    `[인물] id: ${target.cardId} (${target.name})`,
    ...renderList('[기존] traits', target.existingTraits),
    ...renderList('[기존] tags', target.existingTags),
    ...renderList('[후보] traits', target.traits),
    ...renderList('[후보] tags', target.tags),
  ].join('\n');
}

export const NoteCardConsolidationPrompt = {
  config: promptTuning('noteCardConsolidation'),
  build(
    targets: readonly NoteConsolidationTarget[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('noteCardConsolidation', variant, {
      view: { characters: targets.map(renderTarget).join('\n\n') },
    });
  },
} as const;

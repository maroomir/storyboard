import { formatCardAttributes, joinCardText } from '@storyboard/story-model';
import type { BackgroundCard, CharacterCard, ProjectFormat } from '@storyboard/story-model';
import { craftContractLines, type StyleDirective } from '#ai/contracts/styleDirective';
import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export type DraftAugmentScope = 'draft' | 'selection';

export interface DraftAugmentInput {
  readonly target: string;
  readonly scope: DraftAugmentScope;
  readonly format: ProjectFormat;
  readonly cards: readonly string[];
  readonly facts: readonly string[];
  readonly intent?: string;
  readonly instruction?: string;
}

export const DraftAugmentPrompt = {
  config: promptTuning('draftAugment'),
  build(
    input: DraftAugmentInput,
    variant: PromptVariantId = 'generic',
    style?: StyleDirective,
  ): PromptArtifact {
    const instruction = input.instruction?.trim() || undefined;

    // NOTE: The craft contract always renders at least one line, so it is a plain value rather
    // than a standalone partial, which would leave a trailing newline at the end of the system text.
    return renderPrompt('draftAugment', variant, {
      view: {
        isInstructed: instruction !== undefined,
        isSelection: input.scope === 'selection',
        isNovel: input.format === 'novel',
        craftContract: craftContractLines(style?.craftContract).join('\n'),
        instruction,
        cards: input.cards.join('\n\n'),
        facts: input.facts.map((line) => `- ${line}`).join('\n'),
        intent: instruction === undefined ? input.intent?.trim() : undefined,
        target: input.target,
      },
    });
  },
} as const;

export function formatAugmentCards(
  characters: readonly CharacterCard[],
  background: BackgroundCard | undefined,
): string[] {
  const blocks: string[] = [];

  for (const character of characters) {
    const lines = [`[${character.name}] 역할: ${character.role ?? 'extra'}`];
    appendCardLine(lines, '말투', joinCardText(character.voice));
    appendCardLine(lines, '설명', joinCardText(character.description));
    appendCardLine(lines, '욕망', joinCardText(character.desire));
    appendCardLine(lines, '특징', (character.traits ?? []).join(', '));
    appendCardLine(lines, '속성', formatCardAttributes(character.attributes));
    blocks.push(lines.join('\n'));
  }

  if (background) {
    const header = [`[배경: ${background.name}]`, background.time, background.weather]
      .filter((part): part is string => Boolean(part && part.trim().length > 0))
      .join(' ');
    const lines = [header];
    appendCardLine(lines, '묘사', joinCardText(background.description));
    appendCardLine(lines, '감각', joinCardText(background.senses));
    blocks.push(lines.join('\n'));
  }

  return blocks;
}

function appendCardLine(lines: string[], label: string, value: string): void {
  if (value.trim().length > 0) {
    lines.push(`${label}: ${value}`);
  }
}

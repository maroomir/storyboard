import type { NoteExtractionKnownCard, NoteExtractionNote } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

function renderNote(note: NoteExtractionNote): string {
  return [
    `### 노트 id: ${note.id}`,
    ...(note.path.length > 0 ? [`위치: ${note.path.join(' > ')}`] : []),
    `제목: ${note.title}`,
    '',
    note.body.trim(),
  ].join('\n');
}

function renderKnownCard(card: NoteExtractionKnownCard): string {
  const aliases = card.aliases.length > 0 ? ` (다른 호칭: ${card.aliases.join(', ')})` : '';

  return `- ${card.id} · ${card.type === 'character' ? '인물' : '배경'} · ${card.name}${aliases}`;
}

export const NoteExtractionPrompt = {
  config: promptTuning('noteExtraction'),
  build(
    notes: readonly NoteExtractionNote[],
    knownCards: readonly NoteExtractionKnownCard[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('noteExtraction', variant, {
      view: {
        hasKnownCards: knownCards.length > 0,
        knownCards: knownCards.map(renderKnownCard).join('\n'),
        notes: notes.map(renderNote).join('\n\n'),
      },
    });
  },
} as const;

import {
  noteConsolidatedFields,
  type NoteConsolidatedValues,
  type NoteConsolidationTarget,
} from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

const cardKindLabels: Readonly<Record<NoteConsolidationTarget['type'], string>> = {
  character: '인물',
  background: '배경',
};

function renderLists(label: string, values: NoteConsolidatedValues): string[] {
  return noteConsolidatedFields.flatMap((field) => {
    const list = values[field] ?? [];
    return list.length === 0 ? [] : [`${label} ${field}:`, ...list.map((value) => `- ${value}`)];
  });
}

function renderTarget(target: NoteConsolidationTarget): string {
  return [
    `[${cardKindLabels[target.type]}] id: ${target.cardId} (${target.name})`,
    ...renderLists('[기존]', target.existing),
    ...renderLists('[후보]', target.candidates),
    ...target.sharedAliases.map(
      (shared) =>
        `[공유 별칭] ${shared.alias} — ${shared.otherCards
          .map((carrier) => `${carrier.cardId} (${carrier.name})`)
          .join(', ')} 도 가짐`,
    ),
  ].join('\n');
}

export const NoteCardConsolidationPrompt = {
  config: promptTuning('noteCardConsolidation'),
  build(
    targets: readonly NoteConsolidationTarget[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('noteCardConsolidation', variant, {
      view: { cards: targets.map(renderTarget).join('\n\n') },
    });
  },
} as const;

import type React from 'react';

import {
  narrativeTenseLabels,
  narrativeTenses,
  narratorKnowledgeLabels,
  narratorKnowledges,
  narratorPersonLabels,
  narratorPersons,
  type NarrativeTense,
  type NarratorKnowledge,
  type NarratorPerson,
} from '@storyboard/story-model/contracts';
import type { NarratorCard } from '@webview/lib/types';
import { sbInputClass } from '@webview/components/ui/formClasses';
import { ListField } from './ListField';

export function NarratorFields({
  card,
  updateCard,
}: {
  readonly card: NarratorCard;
  readonly updateCard: (card: NarratorCard) => void;
}): React.ReactElement {
  return (
    <>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">인칭</span>
        <select
          className={sbInputClass}
          value={card.person}
          onChange={(event) =>
            updateCard({ ...card, person: event.target.value as NarratorPerson })
          }
        >
          {narratorPersons.map((person) => (
            <option key={person} value={person}>
              {narratorPersonLabels[person]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">지식 범위</span>
        <select
          className={sbInputClass}
          value={card.knowledge}
          onChange={(event) =>
            updateCard({ ...card, knowledge: event.target.value as NarratorKnowledge })
          }
        >
          {narratorKnowledges.map((knowledge) => (
            <option key={knowledge} value={knowledge}>
              {narratorKnowledgeLabels[knowledge]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">시제</span>
        <select
          className={sbInputClass}
          value={card.tense ?? ''}
          onChange={(event) => {
            const { tense: _previousTense, ...rest } = card;
            const value = event.target.value;
            updateCard(value === '' ? rest : { ...rest, tense: value as NarrativeTense });
          }}
        >
          <option value="">지정 안 함 (과거형)</option>
          {narrativeTenses.map((tense) => (
            <option key={tense} value={tense}>
              {narrativeTenseLabels[tense]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">초점 인물</span>
        <input
          className={sbInputClass}
          value={card.focal ?? ''}
          placeholder="인물 카드 id (비우면 씬의 povCharacter)"
          onChange={(event) => {
            const { focal: _previousFocal, ...rest } = card;
            const value = event.target.value;
            updateCard(value === '' ? rest : { ...rest, focal: value });
          }}
        />
      </label>
      <ListField
        label="목소리"
        values={card.voice ?? []}
        onChange={(voice) => updateCard({ ...card, voice })}
      />
    </>
  );
}

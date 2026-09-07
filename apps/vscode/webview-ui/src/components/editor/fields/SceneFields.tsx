import type React from 'react';

import type { SceneCard, SceneGrounding } from '@webview/lib/types';
import { sbInputClass } from '@webview/components/ui/formClasses';
import { ListField } from './ListField';

const sceneTextareaClass = `${sbInputClass} min-h-20 resize-y leading-normal`;

const GROUNDING_FIELDS: readonly { key: keyof SceneGrounding; label: string }[] = [
  { key: 'incident', label: '사건' },
  { key: 'place', label: '장소' },
  { key: 'relation', label: '관계' },
  { key: 'time', label: '시점' },
];

const STRUCTURE_FIELDS: readonly { key: SceneStructureKey; label: string }[] = [
  { key: 'purpose', label: '목적' },
  { key: 'conflict', label: '갈등' },
  { key: 'twist', label: '반전' },
  { key: 'emotionalShift', label: '감정 변화' },
  { key: 'endState', label: '종료 지점' },
];

type SceneStructureKey = 'purpose' | 'conflict' | 'twist' | 'emotionalShift' | 'endState';

export function SceneFields({
  card,
  updateCard,
}: {
  readonly card: SceneCard;
  readonly updateCard: (card: SceneCard) => void;
}): React.ReactElement {
  const updateOptionalText = (
    key: 'title' | 'location' | 'mood' | 'relationStage',
    value: string,
  ): void => {
    updateCard({ ...card, [key]: value === '' ? undefined : value });
  };

  const updateStructureText = (key: SceneStructureKey, value: string): void => {
    updateCard({ ...card, [key]: value === '' ? undefined : value });
  };

  const updateGrounding = (key: keyof SceneGrounding, value: string): void => {
    const grounding: SceneGrounding = {
      ...card.grounding,
      [key]: value === '' ? undefined : value,
    };
    const hasAnyValue = Object.values(grounding).some((entry) => entry !== undefined);
    updateCard({ ...card, grounding: hasAnyValue ? grounding : undefined });
  };

  return (
    <>
      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">Title</span>
        <input
          className={sbInputClass}
          value={card.title ?? ''}
          onChange={(event) => updateOptionalText('title', event.target.value)}
        />
      </label>

      <ListField
        label="Characters"
        values={card.characters ?? []}
        onChange={(characters) =>
          updateCard({ ...card, characters: characters.length > 0 ? characters : undefined })
        }
      />

      <div className="grid grid-cols-2 gap-3 max-[520px]:grid-cols-1">
        <label className="flex min-w-0 flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">Location</span>
          <input
            className={sbInputClass}
            value={card.location ?? ''}
            onChange={(event) => updateOptionalText('location', event.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">Mood</span>
          <input
            className={sbInputClass}
            value={card.mood ?? ''}
            onChange={(event) => updateOptionalText('mood', event.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">Relation Stage</span>
          <input
            className={sbInputClass}
            value={card.relationStage ?? ''}
            onChange={(event) => updateOptionalText('relationStage', event.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-[0.35rem]">
          <span className="text-sm text-sb-fg-muted">목표 분량 (자)</span>
          <input
            className={sbInputClass}
            type="number"
            min={1}
            value={card.targetWordCount ?? ''}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              updateCard({
                ...card,
                targetWordCount: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined,
              });
            }}
          />
        </label>
      </div>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2 rounded-md border border-sb-border p-3">
        <legend className="px-1 text-sm text-sb-fg-muted">사실 시트 (Grounding)</legend>
        {GROUNDING_FIELDS.map(({ key, label }) => (
          <label className="flex flex-col gap-[0.35rem]" key={key}>
            <span className="text-sm text-sb-fg-muted">{label}</span>
            <input
              className={sbInputClass}
              value={card.grounding?.[key] ?? ''}
              onChange={(event) => updateGrounding(key, event.target.value)}
            />
          </label>
        ))}
      </fieldset>

      {STRUCTURE_FIELDS.map(({ key, label }) => (
        <label className="flex flex-col gap-[0.35rem]" key={key}>
          <span className="text-sm text-sb-fg-muted">{label}</span>
          <textarea
            className={sceneTextareaClass}
            value={card[key] ?? ''}
            onChange={(event) => updateStructureText(key, event.target.value)}
          />
        </label>
      ))}

      <ListField
        label="회수할 복선"
        values={card.foreshadowing ?? []}
        onChange={(foreshadowing) =>
          updateCard({
            ...card,
            foreshadowing: foreshadowing.length > 0 ? foreshadowing : undefined,
          })
        }
      />
      <ListField
        label="필요 설정"
        values={card.neededCanon ?? []}
        onChange={(neededCanon) =>
          updateCard({ ...card, neededCanon: neededCanon.length > 0 ? neededCanon : undefined })
        }
      />

      <label className="flex flex-col gap-[0.35rem]">
        <span className="text-sm text-sb-fg-muted">
          Summary (자유 메모 — &lt;stem&gt;.summary.md 에 저장)
        </span>
        <textarea
          className={`${sceneTextareaClass} min-h-36`}
          value={card.summary ?? ''}
          onChange={(event) =>
            updateCard({
              ...card,
              summary: event.target.value === '' ? undefined : event.target.value,
            })
          }
        />
      </label>
    </>
  );
}

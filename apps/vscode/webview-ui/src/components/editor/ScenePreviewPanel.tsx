import clsx from 'clsx';
import type React from 'react';

import type { SceneCard } from '@webview/lib/types';
import { Pill } from '../ui/Pill';

const previewShellClass =
  'relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-sb-border/90 bg-gradient-to-b from-sb-bg-widget/50 via-sb-bg-sidebar to-sb-bg-sidebar/95 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_28px_rgba(0,0,0,0.2)]';

const GROUNDING_LABELS: readonly {
  key: 'incident' | 'place' | 'relation' | 'time';
  label: string;
}[] = [
  { key: 'incident', label: '사건' },
  { key: 'place', label: '장소' },
  { key: 'relation', label: '관계' },
  { key: 'time', label: '시점' },
];

const STRUCTURE_LABELS: readonly {
  key: 'purpose' | 'conflict' | 'twist' | 'emotionalShift' | 'endState';
  label: string;
}[] = [
  { key: 'purpose', label: '목적' },
  { key: 'conflict', label: '갈등' },
  { key: 'twist', label: '반전' },
  { key: 'emotionalShift', label: '감정 변화' },
  { key: 'endState', label: '종료 지점' },
];

export function ScenePreviewPanel({
  card,
  className,
}: {
  readonly card: SceneCard;
  readonly className?: string;
}): React.ReactElement {
  const structureEntries = STRUCTURE_LABELS.filter(({ key }) => card[key] !== undefined);
  const groundingEntries = GROUNDING_LABELS.filter(
    ({ key }) => card.grounding?.[key] !== undefined,
  );

  return (
    <section className={clsx(previewShellClass, className)} aria-label="씬 미리보기">
      <header className="flex flex-col gap-1 border-b border-sb-border/60 pb-3">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
          Scene {card.id}
        </p>
        <h2 className="font-display m-0 text-lg leading-snug text-sb-fg">
          {card.title ?? card.id}
        </h2>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(card.characters ?? []).map((characterId) => (
            <Pill key={characterId}>{characterId}</Pill>
          ))}
          {card.location ? <Pill>@{card.location}</Pill> : null}
          {card.mood ? <Pill>{card.mood}</Pill> : null}
          {card.targetWordCount ? <Pill>약 {card.targetWordCount.toLocaleString()}자</Pill> : null}
        </div>
      </header>

      {groundingEntries.length > 0 ? (
        <dl className="m-0 flex flex-col gap-1.5">
          {groundingEntries.map(({ key, label }) => (
            <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2" key={key}>
              <dt className="text-xs font-semibold text-sb-fg-muted">{label}</dt>
              <dd className="m-0 text-xs leading-normal text-sb-fg">{card.grounding?.[key]}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 text-xs text-sb-fg-muted">사실 시트(grounding)가 아직 비어 있습니다.</p>
      )}

      {structureEntries.map(({ key, label }) => (
        <div className="flex flex-col gap-1" key={key}>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
            {label}
          </p>
          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-sb-fg">{card[key]}</p>
        </div>
      ))}

      {card.summary ? (
        <div className="flex flex-col gap-1 border-t border-sb-border/60 pt-3">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
            Summary
          </p>
          <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-sb-fg">
            {card.summary}
          </p>
        </div>
      ) : null}
    </section>
  );
}

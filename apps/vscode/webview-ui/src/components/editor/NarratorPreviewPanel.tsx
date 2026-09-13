import clsx from 'clsx';
import type React from 'react';

import {
  narrativeTenseLabels,
  narratorKnowledgeLabels,
  narratorPersonLabels,
} from '@storyboard/story-format/contracts';
import type { NarratorCard } from '@webview/lib/types';
import { Pill } from '../ui/Pill';

const previewShellClass =
  'relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-sb-border/90 bg-gradient-to-b from-sb-bg-widget/50 via-sb-bg-sidebar to-sb-bg-sidebar/95 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_28px_rgba(0,0,0,0.2)]';

export function NarratorPreviewPanel({
  card,
  className,
}: {
  readonly card: NarratorCard;
  readonly className?: string;
}): React.ReactElement {
  return (
    <section className={clsx(previewShellClass, className)} aria-label="서술자 미리보기">
      <header className="flex flex-col gap-1 border-b border-sb-border/60 pb-3">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
          Narrator {card.id}
        </p>
        <h2 className="font-display m-0 text-lg leading-snug text-sb-fg">{card.name}</h2>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Pill>{narratorPersonLabels[card.person]}</Pill>
          <Pill>{narratorKnowledgeLabels[card.knowledge]}</Pill>
          <Pill>{narrativeTenseLabels[card.tense ?? 'past']}</Pill>
          {card.focal ? <Pill>초점 {card.focal}</Pill> : null}
        </div>
      </header>

      {card.voice && card.voice.length > 0 ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-xs leading-normal text-sb-fg">
          {card.voice.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

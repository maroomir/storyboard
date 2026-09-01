import clsx from 'clsx';
import type React from 'react';

import { CardTagRow } from '../card/CardTagRow';
import { StoryboardCard as HeroCard } from '../card/StoryboardCard';
import { Pill } from '../ui/Pill';
import { CHARACTER_ROLE_OPTIONS } from '@webview/lib/characterSidebarGroups';
import type { CharacterRole, StoryboardCard } from '@webview/lib/types';

const previewShellClass =
  'relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-xl border border-sb-border/90 bg-gradient-to-b from-sb-bg-widget/50 via-sb-bg-sidebar to-sb-bg-sidebar/95 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_28px_rgba(0,0,0,0.2)]';

const heroFrameClass =
  'overflow-hidden rounded-lg border border-sb-border/80 bg-sb-bg-sidebar/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]';

const roleLabelByValue = Object.fromEntries(
  CHARACTER_ROLE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<CharacterRole, string>;

const locationKindLabel: Record<'place' | 'affiliation', string> = {
  place: '장소',
  affiliation: '소속',
};

export type PreviewPanelProps = {
  readonly card: StoryboardCard;
  readonly imageUri?: string;
  readonly className?: string;
};

export function PreviewPanel({ card, imageUri, className }: PreviewPanelProps): React.ReactElement {
  const roleLabel =
    card.type === 'character' && card.role ? roleLabelByValue[card.role] : undefined;
  const locationLabel =
    card.type !== 'character' && card.locationKind
      ? locationKindLabel[card.locationKind]
      : undefined;

  return (
    <section className={clsx(previewShellClass, className)} aria-label="카드 미리보기">
      <header className="flex flex-col gap-1 border-b border-sb-border/60 pb-3">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-sb-fg-muted">
          Preview
        </p>
        <h2 className="font-display m-0 text-lg leading-snug text-sb-fg">{card.name}</h2>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <CardTagRow cardType={card.type} layout="inline" />
        {roleLabel ? (
          <Pill tone="character" className="normal-case tracking-normal">
            {roleLabel}
          </Pill>
        ) : null}
        {locationLabel ? (
          <Pill tone="background" className="normal-case tracking-normal">
            {locationLabel}
          </Pill>
        ) : null}
      </div>

      <div className={heroFrameClass}>
        <HeroCard
          card={card}
          imageUri={imageUri}
          variant="hero"
          className="rounded-none border-0 shadow-none"
        />
      </div>

      {card.type === 'character' ? (
        <p className="m-0 text-xs leading-normal text-sb-fg-muted">
          이미지는 카드의 profile 경로를 기준으로 표시합니다.
        </p>
      ) : null}
    </section>
  );
}

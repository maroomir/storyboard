import clsx from 'clsx';
import type React from 'react';

import type { StoryboardCard } from '@webview/lib/types';

export type CardImagePaneProps = {
  readonly card: StoryboardCard;
  readonly imageUri?: string;
  readonly variant: 'compact' | 'hero';
  readonly className?: string;
};

function PlaceholderArt({
  card,
  variant,
}: {
  readonly card: StoryboardCard;
  readonly variant: 'compact' | 'hero';
}) {
  const isHero = variant === 'hero';
  return (
    <div className="relative flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 p-3">
      <svg
        className={clsx('text-sb-fg-muted/25', isHero ? 'h-28 w-28' : 'h-14 w-14')}
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          d="M60 8l52 30v44L60 112 8 82V38L60 8z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M60 38v44M38 60h44"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.5"
        />
      </svg>
      {isHero ? null : (
        <span className="text-center font-display text-base leading-snug text-sb-fg drop-shadow-sm">
          {card.name}
        </span>
      )}
    </div>
  );
}

export function CardImagePane({
  card,
  imageUri,
  variant,
  className,
}: CardImagePaneProps): React.ReactElement {
  const isHero = variant === 'hero';
  const baseBg = card.type === 'character' ? 'bg-cardCharacter' : 'bg-cardBackground';

  return (
    <div
      className={clsx(
        'relative h-full min-h-0 w-full overflow-hidden',
        isHero ? 'min-h-[220px]' : 'min-h-0',
        baseBg,
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-sb-parchment/70 via-transparent to-black/55" />
      <div className="pointer-events-none absolute inset-0 z-[2] shadow-[inset_0_0_24px_rgba(0,0,0,0.22)]" />
      {imageUri ? (
        <img
          className={clsx(
            'relative z-[1] h-full w-full object-cover',
            isHero ? 'object-[center_20%]' : 'object-[center_15%]',
          )}
          src={imageUri}
          alt=""
        />
      ) : (
        <div className="relative z-[1] flex h-full min-h-0 w-full flex-1">
          <PlaceholderArt card={card} variant={variant} />
        </div>
      )}
    </div>
  );
}

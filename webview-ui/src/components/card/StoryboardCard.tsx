import type React from "react"

import type { StoryboardCard } from "../../lib/types"

export type StoryboardCardFrameProps = {
  readonly card: StoryboardCard
  readonly imageUri?: string
  readonly variant: "compact" | "hero"
  readonly onOpen?: () => void
}

export function StoryboardCardFrame({
  card,
  imageUri,
  variant,
  onOpen
}: StoryboardCardFrameProps): React.ReactElement {
  const isHero = variant === "hero"
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        isHero
          ? "flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-sb-border bg-sb-bg-sidebar text-left shadow-cardRest transition hover:shadow-cardHover animate-cardEntrance"
          : "flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border border-sb-border bg-sb-bg-sidebar text-left shadow-cardRest transition hover:shadow-cardHover animate-cardEntrance"
      }
    >
      <div
        className={
          isHero
            ? "relative min-h-[200px] flex-1 bg-gradient-to-b from-sb-parchment to-transparent bg-cardCharacter"
            : "relative aspect-[5/6] w-full bg-cardCharacter"
        }
      >
        {imageUri ? (
          <img className="h-full w-full object-cover" src={imageUri} alt="" />
        ) : (
          <div
            className={
              card.type === "background"
                ? "flex h-full min-h-0 w-full flex-1 items-center justify-center bg-cardBackground p-3"
                : "flex h-full min-h-0 w-full flex-1 items-center justify-center p-3"
            }
          >
            <span className="font-display text-center text-lg text-sb-fg">{card.name}</span>
          </div>
        )}
      </div>
      <footer className="flex flex-col gap-1 border-t border-sb-border/80 bg-sb-bg-sidebar/95 p-3">
        <span className="truncate font-semibold text-sb-fg">{card.name}</span>
        {!isHero && card.description ? (
          <span className="line-clamp-2 text-xs text-sb-fg-muted">{card.description}</span>
        ) : null}
      </footer>
    </button>
  )
}

import clsx from "clsx"
import { motion } from "framer-motion"
import type React from "react"

import type { StoryboardCard as StoryboardCardModel } from "@webview/lib/types"
import { CardImagePane } from "./CardImagePane"
import { CardTagRow } from "./CardTagRow"

export type StoryboardCardProps = {
  readonly card: StoryboardCardModel
  readonly imageUri?: string
  readonly variant: "compact" | "hero"
  readonly onOpen?: () => void
  readonly className?: string
}

const shadowRest = "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.12)"

const shadowHover: Record<"character" | "background", string> = {
  character:
    "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 32px rgba(0,0,0,0.24), 0 0 36px rgba(251, 191, 36, 0.24)",
  background:
    "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 32px rgba(0,0,0,0.24), 0 0 36px rgba(45, 212, 191, 0.2)"
}

const motionTap = { scale: 0.99 }

export function StoryboardCard({
  card,
  imageUri,
  variant,
  onOpen,
  className
}: StoryboardCardProps): React.ReactElement {
  const isHero = variant === "hero"
  const glowKey = card.type === "character" ? "character" : "background"

  const compactSecondary =
    card.description?.trim() ||
    [card.role, card.locationKind].filter(Boolean).join(" · ") ||
    ""

  const frameClass = clsx(
    "group flex w-full flex-col overflow-hidden border border-sb-border bg-sb-bg-sidebar text-left shadow-cardRest animate-cardEntrance",
    isHero ? "min-h-[360px] rounded-xl" : "aspect-[9/13] max-w-[200px] rounded-lg",
    onOpen ? "cursor-pointer" : "cursor-default",
    className
  )

  const inner = (
    <>
      <div className={clsx("relative min-h-0", isHero ? "flex min-h-[280px] flex-1 flex-col" : "flex-[3]")}>
        <CardImagePane card={card} imageUri={imageUri} variant={variant} className="min-h-0 flex-1" />
        <div className="absolute left-2 top-2 z-[3]">
          <CardTagRow cardType={card.type} layout="overlay" />
        </div>
        {isHero ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-black/78 via-black/40 to-transparent px-4 pb-4 pt-20">
            <h2 className="font-display m-0 text-2xl leading-tight text-white drop-shadow-sm">{card.name}</h2>
            {card.role ? <p className="mt-1 text-sm text-white/90">{card.role}</p> : null}
            {card.tags?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {card.tags.slice(0, 8).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-white/95"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {!isHero ? (
        <footer className="flex min-h-0 flex-[2] flex-col justify-center gap-1 border-t border-sb-border/80 bg-sb-bg-sidebar/95 p-3">
          <span className="truncate font-semibold leading-snug text-sb-fg">{card.name}</span>
          {compactSecondary ? (
            <span className="line-clamp-2 text-xs leading-normal text-sb-fg-muted">{compactSecondary}</span>
          ) : null}
        </footer>
      ) : null}
    </>
  )

  const transition = { type: "spring" as const, stiffness: 420, damping: 28 }
  const motionProps = {
    initial: { boxShadow: shadowRest },
    whileHover: { y: -4, scale: 1.02, boxShadow: shadowHover[glowKey] },
    transition
  }

  if (onOpen) {
    return (
      <motion.button
        type="button"
        className={frameClass}
        aria-label={`Open ${card.name}`}
        onClick={onOpen}
        whileTap={motionTap}
        {...motionProps}
      >
        {inner}
      </motion.button>
    )
  }

  return (
    <motion.div className={frameClass} {...motionProps}>
      {inner}
    </motion.div>
  )
}


import clsx from "clsx"
import { motion } from "framer-motion"
import type React from "react"

import type { StoryboardCard as StoryboardCardModel } from "@webview/lib/types"
import { cardGameFrameClass, cardGameInnerBevelClass } from "./cardFrameStyles"
import { CardImagePane } from "./CardImagePane"
import { CardRoleBadge } from "./CardRoleBadge"
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

function descriptionExcerpt(description: readonly string[] | undefined, maxLength: number): string | undefined {
  const trimmed = (description ?? []).join("\n").trim()
  if (!trimmed) {
    return undefined
  }
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength).trimEnd()}…`
}

function HeroDescriptionBox({ card }: { readonly card: StoryboardCardModel }): React.ReactElement {
  const excerpt = descriptionExcerpt(card.description, 200)

  return (
    <div className="relative z-[4] border-t border-black/30 bg-gradient-to-b from-sb-bg-sidebar/95 via-sb-bg-sidebar to-black/25 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <h2 className="font-display m-0 text-xl leading-tight text-sb-fg">{card.name}</h2>
      {excerpt ? (
        <p className="mt-2 m-0 line-clamp-3 text-sm leading-relaxed text-sb-fg-muted">{excerpt}</p>
      ) : null}
      {card.tags?.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {card.tags.slice(0, 6).map((tag) => (
            <span
              key={tag}
              className="rounded border border-sb-border/80 bg-sb-bg-widget/80 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-sb-fg-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function StoryboardCard({
  card,
  imageUri,
  variant,
  onOpen,
  className
}: StoryboardCardProps): React.ReactElement {
  const isHero = variant === "hero"
  const glowKey = card.type === "character" ? "character" : "background"
  const showRoleBadge = card.type === "character" && card.role

  const compactSecondary =
    (card.description ?? []).join("\n").trim() ||
    [card.locationKind].filter(Boolean).join(" · ") ||
    ""

  const frameClass = clsx(
    "group relative flex w-full flex-col overflow-hidden text-left animate-cardEntrance",
    cardGameFrameClass(card.type, variant),
    isHero ? "min-h-[380px]" : "aspect-[9/13] max-w-[200px]",
    onOpen ? "cursor-pointer" : "cursor-default",
    className
  )

  const inner = (
    <>
      <div className={cardGameInnerBevelClass(variant)} aria-hidden />
      <div className={clsx("relative flex min-h-0 flex-col", isHero ? "flex-1" : "flex-[7]")}>
        <CardImagePane card={card} imageUri={imageUri} variant={variant} className="min-h-0 flex-1" />
        <div className="absolute left-2 top-2 z-[5]">
          <CardTagRow cardType={card.type} layout="overlay" />
        </div>
        {showRoleBadge ? (
          <div className={clsx("absolute z-[5]", isHero ? "right-3 top-3" : "right-2 top-2")}>
            <CardRoleBadge role={card.role!} size={isHero ? "md" : "sm"} />
          </div>
        ) : null}
        {isHero ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] h-24 bg-gradient-to-t from-black/70 to-transparent" />
        ) : null}
      </div>

      {isHero ? <HeroDescriptionBox card={card} /> : null}

      {!isHero ? (
        <footer className="relative z-[4] flex min-h-0 flex-[3] flex-col justify-center gap-1 border-t border-black/25 bg-gradient-to-b from-sb-bg-sidebar to-sb-bg-sidebar/90 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
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

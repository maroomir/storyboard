import clsx from "clsx"
import { Map, User } from "lucide-react"
import type React from "react"

import type { CardType } from "../../lib/types"
import { Pill } from "../ui/Pill"

export type CardTagRowProps = {
  readonly cardType: CardType
  readonly tags?: readonly string[]
  readonly layout?: "overlay" | "inline"
  readonly className?: string
}

const typeLabel: Record<CardType, string> = {
  character: "Character",
  background: "Background"
}

export function CardTagRow({
  cardType,
  tags,
  layout = "inline",
  className
}: CardTagRowProps): React.ReactElement {
  const tone = cardType === "character" ? "character" : "background"
  const Icon = cardType === "character" ? User : Map

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-1.5",
        layout === "overlay" && "max-w-[calc(100%-1rem)]",
        className
      )}
    >
      <Pill tone={tone} icon={Icon}>
        {typeLabel[cardType]}
      </Pill>
      {layout === "inline" && tags?.length
        ? tags.slice(0, 6).map((tag) => (
            <Pill key={tag} tone="neutral">
              {tag}
            </Pill>
          ))
        : null}
    </div>
  )
}

export function CardFooterTags({ tags }: { readonly tags?: readonly string[] }): React.ReactElement | null {
  if (!tags?.length) {
    return null
  }
  return (
    <div className="flex flex-wrap gap-1">
      {tags.slice(0, 8).map((tag) => (
        <Pill key={tag} tone="neutral">
          {tag}
        </Pill>
      ))}
    </div>
  )
}

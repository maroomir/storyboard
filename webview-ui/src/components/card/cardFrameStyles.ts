import type { CardType } from "@webview/lib/types"

export function cardGameFrameClass(cardType: CardType, variant: "compact" | "hero"): string {
  const radius = variant === "hero" ? "rounded-[0.85rem]" : "rounded-lg"
  const characterFrame =
    "border-2 border-amber-700/55 bg-gradient-to-b from-amber-950/25 via-sb-bg-sidebar to-sb-bg-sidebar shadow-[inset_0_0_0_1px_rgba(251,191,36,0.12),0_10px_28px_rgba(0,0,0,0.28)]"
  const backgroundFrame =
    "border-2 border-teal-800/50 bg-gradient-to-b from-teal-950/20 via-sb-bg-sidebar to-sb-bg-sidebar shadow-[inset_0_0_0_1px_rgba(45,212,191,0.1),0_10px_28px_rgba(0,0,0,0.28)]"

  return `${radius} ${cardType === "character" ? characterFrame : backgroundFrame}`
}

export function cardGameInnerBevelClass(variant: "compact" | "hero"): string {
  const insetRadius = variant === "hero" ? "rounded-[calc(0.85rem-3px)]" : "rounded-[calc(0.5rem-3px)]"
  return `pointer-events-none absolute inset-[3px] ${insetRadius} shadow-[inset_0_2px_8px_rgba(0,0,0,0.35),inset_0_-1px_0_rgba(255,255,255,0.06)] ring-1 ring-black/20`
}

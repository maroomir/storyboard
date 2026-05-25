import type { CharacterRole, SidebarCardSummary } from "./types"

export type CharacterSidebarGroupKey = CharacterRole | "unclassified"

export interface CharacterSidebarSection {
  readonly key: CharacterSidebarGroupKey
  readonly label: string
  readonly cards: readonly SidebarCardSummary[]
}

export const CHARACTER_SIDEBAR_SECTIONS: readonly {
  readonly key: CharacterSidebarGroupKey
  readonly label: string
}[] = [
  { key: "main", label: "주연" },
  { key: "supporting", label: "조연" },
  { key: "extra", label: "엑스트라" },
  { key: "unclassified", label: "미분류" }
]

function characterRoleGroup(role: CharacterRole | undefined): CharacterSidebarGroupKey {
  if (role === "main" || role === "supporting" || role === "extra") {
    return role
  }
  return "unclassified"
}

function sortByKoreanName(left: SidebarCardSummary, right: SidebarCardSummary): number {
  return left.name.localeCompare(right.name, "ko")
}

export function groupCharacterCardsByRole(cards: readonly SidebarCardSummary[]): readonly CharacterSidebarSection[] {
  const buckets = new Map<CharacterSidebarGroupKey, SidebarCardSummary[]>()

  for (const section of CHARACTER_SIDEBAR_SECTIONS) {
    buckets.set(section.key, [])
  }

  for (const card of cards) {
    const key = characterRoleGroup(card.role)
    buckets.get(key)?.push(card)
  }

  return CHARACTER_SIDEBAR_SECTIONS.map((section) => ({
    key: section.key,
    label: section.label,
    cards: (buckets.get(section.key) ?? []).slice().sort(sortByKoreanName)
  })).filter((section) => section.cards.length > 0)
}

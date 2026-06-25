import type { BackgroundCard, LocationBackgroundCard } from "../shared/card"

export type Background = BackgroundCard

export function createEmptyBackground(id: string, name: string): LocationBackgroundCard {
  return {
    type: "location",
    id,
    name,
    locationKind: "place",
    characterIds: [],
    tags: [],
    description: [],
    senses: []
  }
}

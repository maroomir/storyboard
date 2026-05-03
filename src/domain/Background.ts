import type { BackgroundCard } from "../shared/card"

export type Background = BackgroundCard

export function createEmptyBackground(id: string, name: string): Background {
  return {
    type: "background",
    id,
    name,
    concept: `concept/${id}.png`,
    country: "",
    category: "",
    tags: [],
    description: ""
  }
}

import { describe, expect, it } from "vitest"

import { findUncastCharacters, type ChapterPlan } from "@storyboard/story-model"

function planWithScenes(scenes: readonly { title: string; characters: readonly string[] }[]): ChapterPlan {
  return {
    version: "1.0.0",
    acts: [
      {
        id: "act-1",
        title: "1막",
        chapters: [
          {
            id: "ch-1",
            title: "1장",
            scenes: scenes.map((scene, index) => ({
              id: `s${index + 1}`,
              ...scene,
              purpose: "",
              foreshadowing: [],
              neededCanon: []
            }))
          }
        ]
      }
    ]
  }
}

describe("findUncastCharacters", () => {
  it("names each scene once for a person the scene casts twice", () => {
    const plan = planWithScenes([
      { title: "이별", characters: ["hana", "hana"] },
      { title: "재회", characters: ["hana", "jun"] }
    ])

    expect(findUncastCharacters(plan, new Set(["jun"]))).toEqual([{ id: "hana", sceneTitles: ["이별", "재회"] }])
  })
})

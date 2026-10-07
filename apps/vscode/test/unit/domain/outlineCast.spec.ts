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

    expect(findUncastCharacters(plan, new Set(["jun"]))).toEqual({
      cast: [{ id: "hana", sceneTitles: ["이별", "재회"] }],
      unusableIds: []
    })
  })

  it("reports an id no card file could carry instead of dropping it", () => {
    const plan = planWithScenes([{ title: "이별", characters: ["민수", "hana", "JUN"] }])

    expect(findUncastCharacters(plan, new Set())).toEqual({
      cast: [{ id: "hana", sceneTitles: ["이별"] }],
      unusableIds: ["민수", "JUN"]
    })
  })
})

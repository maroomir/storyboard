import { describe, expect, it } from "vitest"

import {
  planSceneBundle,
  projectSceneFile,
  type SceneBundleContent,
  type SceneProjectionLookup
} from "@storyboard/story-model"

const elia = "3f9a2c1e-6b0d-4e7a-9c11-0d2f5a8b7e44"
const sera = "7b1d0c2a-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
const school = "5a70c1d2-3e4f-4a5b-9c6d-7e8f9a0b1c2d"
const narrator = "e1f0a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b"
const rooftop = "c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b"

const slugById: Record<string, string> = { [elia]: "elia", [sera]: "sera", [school]: "school", [narrator]: "elia-first" }
const lookup: SceneProjectionLookup = {
  slugOf: (id) => slugById[id],
  idOf: (_kind, slug) => Object.entries(slugById).find(([, value]) => value === slug)?.[0],
  nameOf: (id) => (id === school ? "학교" : undefined)
}
const studio = { origin: "studio" as const }

const rooftopContent: SceneBundleContent = {
  header: { id: rooftop, slug: "rooftop", kind: "scene", title: "옥상", cast: [elia, sera], place: school },
  statements: [
    { facet: "purpose", value: "엘리아가 처음 무너진다", source: studio },
    { facet: "foreshadowing", value: "손끝이 떨린다", source: studio }
  ],
  beats: [{ text: "엘리아가 옥상 문을 민다" }, { text: "세라가 먼저 와 있다", cast: [elia, sera], place: school, time: "방과 후" }],
  summaryText: "방과 후 옥상.\n"
}

describe("scene projection", () => {
  it("projects a scene bundle and its structure entry into the scene the pipeline reads", () => {
    const scene = projectSceneFile(
      rooftopContent,
      { stem: "002-rooftop", number: 2, entry: { scene: rooftop, thread: "jun", narrator, storyTime: 3 } },
      lookup
    )

    expect(scene).toMatchObject({ stem: "002-rooftop", order: 2, orderText: "002", slug: "rooftop", summaryText: "방과 후 옥상.\n" })
    expect(scene.card).toEqual({
      type: "scene",
      id: "002-rooftop",
      title: "옥상",
      characters: ["elia", "sera"],
      location: "school",
      thread: "jun",
      narrator: "elia-first",
      storyTime: 3,
      purpose: "엘리아가 처음 무너진다",
      foreshadowing: ["손끝이 떨린다"],
      beats: [{ text: "엘리아가 옥상 문을 민다" }, { text: "세라가 먼저 와 있다", cast: ["elia", "sera"], place: "학교", time: "방과 후" }]
    })
    expect(scene.body).toContain("방과 후 옥상.")
  })

  it("plans a bundle back from a scene card, resolving cast and place by name and keeping the uuid", () => {
    const planned = planSceneBundle(
      {
        type: "scene",
        id: "002-rooftop",
        title: "옥상",
        characters: ["elia", "세라"],
        location: "school",
        thread: "jun",
        purpose: "엘리아가 처음 무너진다",
        beats: ["엘리아가 옥상 문을 민다", { text: "세라가 먼저 와 있다", cast: ["세라", "모르는 이"], place: "학교", time: "방과 후" }]
      },
      {
        current: rooftopContent,
        newId: "unused",
        slug: "rooftop",
        resolvers: {
          characterIdOf: (reference) => ({ elia, 세라: sera })[reference],
          placeIdOf: (reference) => ({ school, 학교: school })[reference]
        },
        narratorIdOf: () => undefined,
        source: studio
      }
    )

    expect(planned.content.header).toEqual({ id: rooftop, slug: "rooftop", kind: "scene", title: "옥상", cast: [elia, sera], place: school })
    expect(planned.content.statements.map((line) => [line.facet, line.value])).toEqual([["purpose", "엘리아가 처음 무너진다"]])
    expect(planned.content.beats).toEqual([
      { text: "엘리아가 옥상 문을 민다" },
      { text: "세라가 먼저 와 있다", cast: [sera], place: school, time: "방과 후" }
    ])
    expect(planned.placement).toEqual({ thread: "jun" })
    expect(planned.content.summaryText).toBe("방과 후 옥상.\n")
  })
})

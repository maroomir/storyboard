import { describe, expect, it } from "vitest"

import {
  beatSchema,
  elementHeaderSchemas,
  getElementDisplayName,
  isSceneSlug,
  type ElementHeader,
} from "@storyboard/story-model"

const elia = "3f9a2c1e-6b0d-4e7a-9c11-0d2f5a8b7e44"
const sera = "7b1d2e90-4c3a-4f1b-8d2e-5a6b7c8d9e0f"
const school = "5a70c1d2-3e4f-4a5b-9c6d-7e8f9a0b1c2d"
const rooftop = "c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b"

describe("element headers", () => {
  it("reads a character header with the three attribute keys", () => {
    const header = elementHeaderSchemas.character.parse({
      id: elia,
      slug: "elia",
      kind: "character",
      name: "엘리아",
      role: "main",
      attributes: { age: 17, job: "학생" },
      aliases: ["엘리"],
    })

    expect(getElementDisplayName(header)).toBe("엘리아")
  })

  it("closes the attributes and drops the fields the design retired", () => {
    const base = { id: elia, slug: "elia", kind: "character", name: "엘리아" }

    expect(elementHeaderSchemas.character.safeParse({ ...base, attributes: { height: 160 } }).success).toBe(false)
    for (const retired of ["tags", "recentDialogues", "profile", "traits", "relations"]) {
      expect(elementHeaderSchemas.character.safeParse({ ...base, [retired]: [] }).success, retired).toBe(false)
    }
  })

  it("keeps a background to a place inside another place", () => {
    const header = elementHeaderSchemas.background.parse({
      id: rooftop,
      slug: "rooftop",
      kind: "background",
      name: "옥상",
      within: school,
    })

    expect(header).toMatchObject({ within: school })
    for (const retired of ["type", "locationKind", "characterIds"]) {
      expect(
        elementHeaderSchemas.background.safeParse({ id: school, slug: "school", kind: "background", name: "학교", [retired]: "place" }).success,
        retired,
      ).toBe(false)
    }
  })

  it("points a narrator's focal at a character uuid", () => {
    const narrator = { id: sera, slug: "elia-first", kind: "narrator", name: "엘리아 1인칭", person: "first", knowledge: "witnessed" }

    expect(elementHeaderSchemas.narrator.safeParse({ ...narrator, focal: elia }).success).toBe(true)
    expect(elementHeaderSchemas.narrator.safeParse({ ...narrator, focal: "elia" }).success).toBe(false)
  })

  it("reads a scene header with cast and place as uuids and no number in the slug", () => {
    const header: ElementHeader = elementHeaderSchemas.scene.parse({
      id: rooftop,
      slug: "rooftop",
      kind: "scene",
      title: "옥상",
      cast: [elia, sera],
      place: school,
      time: "방과 후",
    })

    expect(getElementDisplayName(header)).toBe("옥상")
    expect(isSceneSlug("002-rooftop")).toBe(false)
    expect(isSceneSlug("2")).toBe(false)
    expect(isSceneSlug("2024-reunion")).toBe(true)
    for (const retired of ["summary", "mood", "povCharacter", "relationStage", "thread", "narrator", "grounding", "beats"]) {
      expect(
        elementHeaderSchemas.scene.safeParse({ id: rooftop, slug: "rooftop", kind: "scene", title: "옥상", [retired]: "x" }).success,
        retired,
      ).toBe(false)
    }
  })

  it("keeps every beat an object with optional coordinates", () => {
    expect(beatSchema.safeParse({ text: "세라가 먼저 와 있다", cast: [elia, sera], time: "방과 후" }).success).toBe(true)
    expect(beatSchema.safeParse("세라가 먼저 와 있다").success).toBe(false)
    expect(beatSchema.safeParse({ text: "x", place: "옥상 난간" }).success).toBe(false)
  })
})

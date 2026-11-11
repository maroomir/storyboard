import { describe, expect, it } from "vitest"

import {
  deriveSceneNumber,
  deriveSceneStem,
  expectedSceneDirectoryName,
  listMisnumberedScenes,
  planSceneRenames,
  type SceneBundleOnDisk,
  type SceneRenameStep,
  type StoryStructure,
} from "@storyboard/story-model"

const arrival = "9d41b2c3-4d5e-4f6a-8b7c-1d2e3f4a5b6c"
const rooftop = "c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b"
const letter = "4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b"

function structureOf(...sceneIds: string[]): StoryStructure {
  return {
    threads: [{ id: "main", title: "본편" }, { id: "jun", title: "준" }],
    scenes: sceneIds.map((scene) => ({ scene, thread: scene === letter ? "jun" : "main" })),
  }
}

function applySteps(names: readonly string[], steps: readonly SceneRenameStep[]): string[] {
  const present = new Set(names)
  for (const step of steps) {
    expect(present.has(step.from), step.from).toBe(true)
    expect(present.has(step.to), step.to).toBe(false)
    present.delete(step.from)
    present.add(step.to)
  }
  return [...present].sort()
}

describe("scene numbering", () => {
  it("numbers the scenes by their place in the one structure order, whatever their thread", () => {
    const structure = structureOf(arrival, letter, rooftop)

    expect(deriveSceneNumber(structure, rooftop)).toBe(3)
    expect(deriveSceneStem(structure, letter, "letter")).toBe("002-letter")
    expect(expectedSceneDirectoryName(structure, arrival, "arrival")).toBe("001-arrival.card")
    expect(deriveSceneNumber(structure, "00000000-0000-4000-8000-000000000000")).toBeUndefined()
  })

  it("plans no rename when the folders already follow the structure", () => {
    const bundles: SceneBundleOnDisk[] = [
      { sceneId: arrival, slug: "arrival", directoryName: "001-arrival.card", hasDraft: true },
      { sceneId: rooftop, slug: "rooftop", directoryName: "002-rooftop.card", hasDraft: false },
    ]

    expect(planSceneRenames(structureOf(arrival, rooftop), bundles).steps).toEqual([])
  })

  it("shifts the later folders and drafts when a scene is inserted before them", () => {
    const bundles: SceneBundleOnDisk[] = [
      { sceneId: arrival, slug: "arrival", directoryName: "001-arrival.card", hasDraft: true },
      { sceneId: rooftop, slug: "rooftop", directoryName: "002-rooftop.card", hasDraft: true },
      { sceneId: letter, slug: "letter", directoryName: "003-letter.card", hasDraft: false },
    ]
    const plan = planSceneRenames(structureOf(letter, arrival, rooftop), bundles)
    const before = ["scene/001-arrival.card", "scene/002-rooftop.card", "scene/003-letter.card", "draft/001-arrival.md", "draft/002-rooftop.md"]

    expect(applySteps(before, plan.steps)).toEqual(
      ["draft/002-arrival.md", "draft/003-rooftop.md", "scene/001-letter.card", "scene/002-arrival.card", "scene/003-rooftop.card"],
    )
    expect(listMisnumberedScenes(structureOf(letter, arrival, rooftop), bundles)).toHaveLength(3)
  })

  it("swaps two scenes through holding names so no step lands on a taken name", () => {
    const bundles: SceneBundleOnDisk[] = [
      { sceneId: arrival, slug: "arrival", directoryName: "001-arrival.card", hasDraft: false },
      { sceneId: rooftop, slug: "arrival", directoryName: "002-arrival.card", hasDraft: false },
    ]
    const plan = planSceneRenames(structureOf(rooftop, arrival), bundles)

    expect(plan.steps.some((step) => step.to.includes(".renaming-"))).toBe(true)
    expect(applySteps(["scene/001-arrival.card", "scene/002-arrival.card"], plan.steps)).toEqual([
      "scene/001-arrival.card",
      "scene/002-arrival.card",
    ])
    expect(plan.steps.find((step) => step.sceneId === rooftop && !step.to.includes(".renaming-"))?.to).toBe("scene/001-arrival.card")
  })

  it("reports the bundles the structure does not place and the entries with no bundle", () => {
    const bundles: SceneBundleOnDisk[] = [{ sceneId: letter, slug: "letter", directoryName: "009-letter.card", hasDraft: false }]
    const plan = planSceneRenames(structureOf(arrival), bundles)

    expect(plan).toEqual({ steps: [], unplacedSceneIds: [letter], missingSceneIds: [arrival] })
  })
})

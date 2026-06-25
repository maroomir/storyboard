import { describe, expect, it } from "vitest"

import {
  buildSeedWritePlan,
  collectTrackedCardAndSceneRelativePathsFromFileNames,
  computeSeedDeletionCandidates,
  isSeedSyncExcludedPath,
  listSeedPlanContentConflictRelativePaths,
  normalizeRelativePath
} from "@/files/seedImport"
import { parseProjectJson } from "@/files/projectJson"
import type { DecodedSeedContent } from "@/services/seedcoat/projectAdapter"

function minimalDecodedSeed(): DecodedSeedContent {
  return {
    project: parseProjectJson(
      JSON.stringify({
        version: "1.0.0",
        id: "00000000-0000-4000-8000-000000000001",
        name: "테스트",
        format: "novel",
        language: "ko",
        createdAt: "2026-05-13T08:00:00.000Z",
        editor: { scenePrefixDigits: 2 }
      })
    ),
    characters: [{ type: "character", id: "hero", name: "주인공" }],
    backgrounds: [
      {
        type: "location",
        id: "bg1",
        name: "배경",
        locationKind: "place",
        characterIds: [],
        tags: [],
        description: []
      }
    ],
    scenes: [{ stem: "01-prologue", content: "scene body\n" }]
  }
}

describe("seedImport", () => {
  it("normalizes relative paths for comparisons", () => {
    expect(normalizeRelativePath(".\\draft\\x.md")).toBe("draft/x.md")
    expect(normalizeRelativePath("/scene/01-a.txt")).toBe("scene/01-a.txt")
  })

  it("marks draft and storyboard cache prefixes as sync-excluded", () => {
    expect(isSeedSyncExcludedPath("draft/foo.md")).toBe(true)
    expect(isSeedSyncExcludedPath(".storyboard/cache/scenes/x.json")).toBe(true)
    expect(isSeedSyncExcludedPath("character/hero.card")).toBe(false)
  })

  it("buildSeedWritePlan maps project, cards, and scenes to stable sorted paths", () => {
    const seed: DecodedSeedContent = {
      project: parseProjectJson(
        JSON.stringify({
          version: "1.0.0",
          id: "00000000-0000-4000-8000-000000000001",
          name: "테스트",
          format: "novel",
          language: "ko",
          createdAt: "2026-05-13T08:00:00.000Z",
          editor: { scenePrefixDigits: 2 }
        })
      ),
      characters: [
        { type: "character", id: "zebra", name: "Z" },
        { type: "character", id: "alpha", name: "A" }
      ],
      backgrounds: [
        {
          type: "location",
          id: "bg1",
          name: "B",
          locationKind: "place",
          characterIds: [],
          tags: [],
          description: []
        }
      ],
      scenes: [
        { stem: "02-second", content: "b" },
        { stem: "01-first", content: "a" }
      ]
    }

    const plan = buildSeedWritePlan(seed)
    const paths = plan.map((entry) => entry.relativePath)

    expect(paths[0]).toBe(".storyboard/project.json")
    expect(paths.slice(1, 3)).toEqual(["character/alpha.card", "character/zebra.card"])
    expect(paths[3]).toBe("background/bg1.card")
    expect(paths.slice(4)).toEqual(["scene/01-first.txt", "scene/02-second.txt"])

    expect(() => parseProjectJson(plan[0]!.content)).not.toThrow()
    expect(plan.find((e) => e.relativePath === "scene/01-first.txt")?.content).toBe("a")
  })

  it("computeSeedDeletionCandidates lists cards and scenes missing from seed, excluding samples and excluded dirs", () => {
    const seed = minimalDecodedSeed()

    const existing = [
      "character/hero.card",
      "character/orphan.card",
      "character/.sample.card",
      "background/bg1.card",
      "background/old.card",
      "scene/01-prologue.txt",
      "scene/02-unused.txt",
      "scene/.sample.txt",
      "draft/01-prologue.md",
      ".storyboard/cache/scenes/x.json",
      "character/profile/hero.png"
    ]

    expect([...computeSeedDeletionCandidates(existing, seed)].sort()).toEqual(
      ["background/old.card", "character/orphan.card", "scene/02-unused.txt"].sort()
    )
  })

  it("collectTrackedCardAndSceneRelativePathsFromFileNames lists only root-level tracked cards and valid scenes", () => {
    const paths = collectTrackedCardAndSceneRelativePathsFromFileNames({
      characterFileNames: [".sample.card", "hero.card", "not-a-card.txt"],
      backgroundFileNames: ["bg.card"],
      sceneFileNames: [".sample.txt", "01-a.txt", "invalid-scene-name.txt"]
    })

    expect(paths.sort()).toEqual(["background/bg.card", "character/hero.card", "scene/01-a.txt"])
  })

  it("listSeedPlanContentConflictRelativePaths lists paths where existing content differs", () => {
    const plan = buildSeedWritePlan(minimalDecodedSeed())
    const existing = new Map<string, string>([["character/hero.card", "different"]])

    expect(listSeedPlanContentConflictRelativePaths(plan, existing)).toContain("character/hero.card")
  })

  it("listSeedPlanContentConflictRelativePaths ignores missing files and identical content", () => {
    const plan: { relativePath: string; content: string }[] = [
      { relativePath: "scene/01-prologue.txt", content: "same" }
    ]
    const existing = new Map<string, string>([
      ["scene/01-prologue.txt", "same"],
      ["other.txt", "x"]
    ])

    expect(listSeedPlanContentConflictRelativePaths(plan, existing)).toEqual([])
  })

  it("does not treat invalid scene filenames as deletion candidates", () => {
    const seed = minimalDecodedSeed()

    expect(computeSeedDeletionCandidates(["scene/not-a-valid-scene.txt"], seed)).toEqual([])
  })
})

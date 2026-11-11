import { describe, expect, it } from "vitest"

import {
  BundlePathError,
  bundleFileRelativePath,
  bundleMemoryRelativePath,
  bundleRelativePath,
  draftRevisionRelativeDirectory,
  formatBundleDirectoryName,
  formatSceneNumber,
  isKnownBundleEntry,
  numberedDraftRelativePath,
  parseBundleDirectoryName,
  parseNumberedSceneStem,
  sceneCacheRelativeDirectory,
} from "@storyboard/story-model"

const rooftop = "c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b"

describe("bundle paths", () => {
  it("names a card bundle by its slug and a scene bundle by its derived number", () => {
    const characterBundle = bundleRelativePath("character", formatBundleDirectoryName("character", { slug: "elia" }))
    const sceneBundle = bundleRelativePath("scene", formatBundleDirectoryName("scene", { slug: "rooftop", sceneNumber: 2 }))

    expect(characterBundle).toBe("character/elia.card")
    expect(sceneBundle).toBe("scene/002-rooftop.card")
    expect(bundleFileRelativePath(characterBundle, "statements")).toBe("character/elia.card/statements.yaml")
    expect(bundleFileRelativePath(characterBundle, "profileImage")).toBe("character/elia.card/profile.png")
    expect(bundleMemoryRelativePath(characterBundle, "main")).toBe("character/elia.card/memory/main.yaml")
    expect(bundleFileRelativePath(sceneBundle, "state")).toBe("scene/002-rooftop.card/state.yaml")
  })

  it("keeps the scene number to three digits", () => {
    expect(formatSceneNumber(1)).toBe("001")
    expect(formatSceneNumber(999)).toBe("999")
    expect(() => formatSceneNumber(1000)).toThrow(BundlePathError)
    expect(() => formatSceneNumber(0)).toThrow(BundlePathError)
    expect(() => formatBundleDirectoryName("scene", { slug: "rooftop" })).toThrow(BundlePathError)
  })

  it("reads a folder name back and refuses one that does not fit its kind", () => {
    expect(parseBundleDirectoryName("scene", "002-rooftop.card")).toEqual({ slug: "rooftop", sceneNumber: 2 })
    expect(parseBundleDirectoryName("scene", "02-rooftop.card")).toBeUndefined()
    expect(parseBundleDirectoryName("scene", "rooftop.card")).toBeUndefined()
    expect(parseBundleDirectoryName("character", "elia.card")).toEqual({ slug: "elia" })
    expect(parseBundleDirectoryName("character", "elia.card.bak")).toBeUndefined()
    expect(parseNumberedSceneStem("010-001-x")).toBeUndefined()
    expect(() => formatBundleDirectoryName("character", { slug: "Elia" })).toThrow(BundlePathError)
  })

  it("puts drafts beside the bundles and the scene caches under the scene uuid", () => {
    expect(numberedDraftRelativePath("002-rooftop")).toBe("draft/002-rooftop.md")
    expect(sceneCacheRelativeDirectory(rooftop)).toBe(`.storyboard/cache/scenes/${rooftop}`)
    expect(draftRevisionRelativeDirectory(rooftop)).toBe(`.storyboard/cache/revisions/${rooftop}`)
  })

  it("knows which entries belong in each kind of bundle", () => {
    expect(isKnownBundleEntry("character", "memory")).toBe(true)
    expect(isKnownBundleEntry("narrator", "memory")).toBe(false)
    expect(isKnownBundleEntry("scene", "beats.yaml")).toBe(true)
    expect(isKnownBundleEntry("character", "beats.yaml")).toBe(false)
    expect(isKnownBundleEntry("background", "image.png")).toBe(true)
    expect(isKnownBundleEntry("character", "notes.txt")).toBe(false)
  })
})

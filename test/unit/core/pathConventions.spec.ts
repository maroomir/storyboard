import { describe, expect, it } from "vitest"

import {
  getStoryboardProjectPaths,
  isHiddenSceneFileName,
  isIgnoredSampleCardFileName
} from "../../../src/core/pathConventions"
import { Uri } from "../../stubs/vscode"

describe("pathConventions", () => {
  it("uses hidden sample paths for initialized sample files", () => {
    const paths = getStoryboardProjectPaths(Uri.file("/workspace/story") as never)

    expect(paths.sampleCharacterCard.fsPath).toBe("/workspace/story/character/.sample.card")
    expect(paths.sampleBackgroundCard.fsPath).toBe("/workspace/story/background/.sample.card")
    expect(paths.sampleScene.fsPath).toBe("/workspace/story/scene/.sample.txt")
  })

  it("identifies only the explicit ignored sample card file", () => {
    expect(isIgnoredSampleCardFileName(".sample.card")).toBe(true)
    expect(isIgnoredSampleCardFileName("sample.card")).toBe(false)
    expect(isIgnoredSampleCardFileName(".draft.card")).toBe(false)
  })

  it("identifies hidden scene text files", () => {
    expect(isHiddenSceneFileName(".sample.txt")).toBe(true)
    expect(isHiddenSceneFileName("01-prologue.txt")).toBe(false)
    expect(isHiddenSceneFileName(".sample.md")).toBe(false)
  })
})
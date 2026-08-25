import { describe, expect, it } from "vitest"

import {
  getStoryboardProjectPaths,
  isDirectSceneCardFile,
  isDraftMarkdownFile,
  isHiddenSceneFileName,
  isIgnoredSampleCardFileName
} from "@/infrastructure/vscode/pathConventions"
import { Uri, type WorkspaceFolder } from "../../../stubs/vscode"

describe("pathConventions", () => {
  it("uses hidden sample paths for initialized sample files", () => {
    const paths = getStoryboardProjectPaths(Uri.file("/workspace/story") as never)

    expect(paths.sampleCharacterCard.fsPath).toBe("/workspace/story/character/.sample.card")
    expect(paths.sampleBackgroundCard.fsPath).toBe("/workspace/story/background/.sample.card")
    expect(paths.sampleScene.fsPath).toBe("/workspace/story/scene/.sample.card")
  })

  it("identifies only the explicit ignored sample card file", () => {
    expect(isIgnoredSampleCardFileName(".sample.card")).toBe(true)
    expect(isIgnoredSampleCardFileName("sample.card")).toBe(false)
    expect(isIgnoredSampleCardFileName(".draft.card")).toBe(false)
  })

  it("identifies hidden scene text files", () => {
    expect(isHiddenSceneFileName(".sample.card")).toBe(true)
    expect(isHiddenSceneFileName("01-prologue.card")).toBe(false)
    expect(isHiddenSceneFileName(".sample.md")).toBe(false)
  })
})

function workspaceFolderAt(rootPath: string): WorkspaceFolder {
  return { uri: Uri.file(rootPath) as never, name: "project", index: 0 }
}

const workspaceFolder = workspaceFolderAt("/workspace/story")

interface PathContractCase {
  readonly label: string
  readonly filePath: string
  readonly expected: boolean
}

describe("isDraftMarkdownFile contract", () => {
  const cases: PathContractCase[] = [
    { label: "direct .md in draft dir", filePath: "/workspace/story/draft/foo.md", expected: true },
    { label: "wrong extension .txt", filePath: "/workspace/story/draft/foo.txt", expected: false },
    { label: "wrong extension .markdown", filePath: "/workspace/story/draft/foo.markdown", expected: false },
    { label: "nested under a subdirectory", filePath: "/workspace/story/draft/sub/foo.md", expected: false },
    { label: "outside the draft dir", filePath: "/workspace/story/notes/foo.md", expected: false },
    { label: "sibling sharing the draft prefix", filePath: "/workspace/story/draftxyz/foo.md", expected: false },
    { label: "case-mismatched dir and file (codec is lowercase-only)", filePath: "/workspace/story/Draft/Foo.MD", expected: false }
  ]

  it.each(cases)("$label → $expected", ({ filePath, expected }) => {
    expect(isDraftMarkdownFile(Uri.file(filePath) as never, workspaceFolder)).toBe(expected)
  })

  it("normalizes backslash paths to forward slashes", () => {
    const windowsWorkspace = workspaceFolderAt("C:\\workspace\\story")
    const draftFile = Uri.file("C:\\workspace\\story\\draft\\foo.md")

    expect(isDraftMarkdownFile(draftFile as never, windowsWorkspace)).toBe(true)
  })
})

describe("isDirectSceneCardFile contract", () => {
  const cases: PathContractCase[] = [
    { label: "direct .card in scene dir", filePath: "/workspace/story/scene/01.card", expected: true },
    { label: "legacy extension .txt", filePath: "/workspace/story/scene/01.txt", expected: false },
    { label: "wrong extension .md", filePath: "/workspace/story/scene/01.md", expected: false },
    { label: "nested under a subdirectory", filePath: "/workspace/story/scene/sub/01.card", expected: false },
    { label: "outside the scene dir", filePath: "/workspace/story/notes/01.card", expected: false },
    { label: "sibling sharing the scene prefix", filePath: "/workspace/story/scenexyz/01.card", expected: false },
    { label: "case-mismatched dir and file (codec is lowercase-only)", filePath: "/workspace/story/SCENE/01.CARD", expected: false }
  ]

  it.each(cases)("$label → $expected", ({ filePath, expected }) => {
    expect(isDirectSceneCardFile(Uri.file(filePath) as never, workspaceFolder)).toBe(expected)
  })

  it("normalizes backslash paths to forward slashes", () => {
    const windowsWorkspace = workspaceFolderAt("C:\\workspace\\story")
    const sceneFile = Uri.file("C:\\workspace\\story\\scene\\01.card")

    expect(isDirectSceneCardFile(sceneFile as never, windowsWorkspace)).toBe(true)
  })
})
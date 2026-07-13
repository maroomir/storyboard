import { describe, expect, it } from "vitest"

import {
  getStoryboardProjectPaths,
  isDirectSceneTextFile,
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
    { label: "case-insensitive dir and file", filePath: "/workspace/story/Draft/Foo.MD", expected: true }
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

describe("isDirectSceneTextFile contract", () => {
  const cases: PathContractCase[] = [
    { label: "direct .txt in scene dir", filePath: "/workspace/story/scene/01.txt", expected: true },
    { label: "wrong extension .md", filePath: "/workspace/story/scene/01.md", expected: false },
    { label: "nested under a subdirectory", filePath: "/workspace/story/scene/sub/01.txt", expected: false },
    { label: "outside the scene dir", filePath: "/workspace/story/notes/01.txt", expected: false },
    { label: "sibling sharing the scene prefix", filePath: "/workspace/story/scenexyz/01.txt", expected: false },
    { label: "case-insensitive dir and file", filePath: "/workspace/story/SCENE/01.TXT", expected: true }
  ]

  it.each(cases)("$label → $expected", ({ filePath, expected }) => {
    expect(isDirectSceneTextFile(Uri.file(filePath) as never, workspaceFolder)).toBe(expected)
  })

  it("normalizes backslash paths to forward slashes", () => {
    const windowsWorkspace = workspaceFolderAt("C:\\workspace\\story")
    const sceneFile = Uri.file("C:\\workspace\\story\\scene\\01.txt")

    expect(isDirectSceneTextFile(sceneFile as never, windowsWorkspace)).toBe(true)
  })
})
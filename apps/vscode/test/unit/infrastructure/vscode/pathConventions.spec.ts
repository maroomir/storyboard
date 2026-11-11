import { describe, expect, it } from "vitest"

import {
  isDirectBackgroundCardFile,
  isDirectCharacterCardFile,
  isDirectSceneCardFile,
  isDraftMarkdownFile,
  resolveSceneBundleStem,
} from "@storyboard/story-model"
import { Uri, type WorkspaceFolder } from "../../../stubs/vscode"

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
describe("card file contracts", () => {
  const characterCases: PathContractCase[] = [
    { label: "card.yaml of a character bundle", filePath: "/workspace/story/character/seorin.card/card.yaml", expected: true },
    { label: "profile image inside the bundle", filePath: "/workspace/story/character/seorin.card/profile.png", expected: false },
    { label: "statements beside the header", filePath: "/workspace/story/character/seorin.card/statements.yaml", expected: false },
    { label: "nested under a subdirectory", filePath: "/workspace/story/character/sub/seorin.card/card.yaml", expected: false },
    { label: "sibling sharing the character prefix", filePath: "/workspace/story/characters/seorin.card/card.yaml", expected: false },
    { label: "background card is not a character card", filePath: "/workspace/story/background/subway.card/card.yaml", expected: false }
  ]

  it.each(characterCases)("character: $label → $expected", ({ filePath, expected }) => {
    expect(isDirectCharacterCardFile(Uri.file(filePath) as never, workspaceFolder)).toBe(expected)
  })

  const backgroundCases: PathContractCase[] = [
    { label: "card.yaml of a background bundle", filePath: "/workspace/story/background/subway.card/card.yaml", expected: true },
    { label: "nested under a subdirectory", filePath: "/workspace/story/background/sub/subway.card/card.yaml", expected: false },
    { label: "character card is not a background card", filePath: "/workspace/story/character/seorin.card/card.yaml", expected: false }
  ]

  it.each(backgroundCases)("background: $label → $expected", ({ filePath, expected }) => {
    expect(isDirectBackgroundCardFile(Uri.file(filePath) as never, workspaceFolder)).toBe(expected)
  })
})

describe("resolveSceneBundleStem contract", () => {
  const cases: readonly { readonly label: string; readonly filePath: string; readonly expected: string | undefined }[] = [
    { label: "the bundle folder", filePath: "/workspace/story/scene/003-rooftop.card", expected: "003-rooftop" },
    { label: "card.yaml inside the bundle", filePath: "/workspace/story/scene/003-rooftop.card/card.yaml", expected: "003-rooftop" },
    { label: "beats.yaml inside the bundle", filePath: "/workspace/story/scene/003-rooftop.card/beats.yaml", expected: "003-rooftop" },
    { label: "a folder without a number", filePath: "/workspace/story/scene/rooftop.card/card.yaml", expected: undefined },
    { label: "nested deeper than the bundle", filePath: "/workspace/story/scene/003-rooftop.card/sub/card.yaml", expected: undefined },
    { label: "a character bundle", filePath: "/workspace/story/character/seorin.card/card.yaml", expected: undefined }
  ]

  it.each(cases)("$label → $expected", ({ filePath, expected }) => {
    expect(resolveSceneBundleStem(Uri.file(filePath) as never, workspaceFolder)).toBe(expected)
  })
})

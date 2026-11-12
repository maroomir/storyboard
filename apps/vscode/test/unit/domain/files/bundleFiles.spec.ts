import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  BundleFileError,
  findStatementsOutsideKind,
  parseBeatsFile,
  parseChapterOutline,
  parseElementCard,
  parseElementMemory,
  parseSceneDialogue,
  parseSceneStateFile,
  parseStatementsFile,
  parseStoryStructure,
  serializeBeatsFile,
  serializeChapterOutline,
  serializeElementCard,
  serializeElementMemory,
  serializeSceneDialogue,
  serializeSceneStateFile,
  serializeStatementsFile,
  serializeStoryStructure,
  type ElementKind,
} from "@storyboard/story-model"
import { parseProjectJson, serializeProjectJson } from "@storyboard/story-engine"

const bundlesRoot = fileURLToPath(new URL("../../../../../../packages/story-model/test/fixtures/bundles/magicboy/", import.meta.url))

const kindByDirectory: Record<string, ElementKind> = {
  character: "character",
  background: "background",
  narrator: "narrator",
  scene: "scene",
}

function listFixtureFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? listFixtureFiles(path) : [relative(bundlesRoot, path)]
  })
}

function roundTrip(relativePath: string, text: string): string {
  const kind = kindByDirectory[relativePath.split("/")[0] ?? ""]
  const fileName = relativePath.split("/").at(-1)
  if (relativePath === ".storyboard/structure.yaml") return serializeStoryStructure(parseStoryStructure(text, relativePath))
  if (relativePath === ".storyboard/project.json") return serializeProjectJson(parseProjectJson(text))
  if (relativePath === ".storyboard/outline/chapters.yaml") return serializeChapterOutline(parseChapterOutline(text))
  if (relativePath.includes("/memory/")) return serializeElementMemory(parseElementMemory(text, relativePath))
  if (kind === undefined) throw new Error(`no codec for ${relativePath}`)
  if (fileName === "card.yaml") return serializeElementCard(parseElementCard(kind, text, relativePath))
  if (fileName === "statements.yaml") {
    const statements = parseStatementsFile(text, relativePath)
    expect(findStatementsOutsideKind(kind, statements), relativePath).toEqual([])
    return serializeStatementsFile(statements)
  }
  if (fileName === "beats.yaml") return serializeBeatsFile(parseBeatsFile(text, relativePath))
  if (fileName === "state.yaml") return serializeSceneStateFile(parseSceneStateFile(text, relativePath))
  if (fileName === "dialogue.json") return serializeSceneDialogue(parseSceneDialogue(text))
  if (fileName === "summary.md") return `${text.trim()}\n`
  throw new Error(`no codec for ${relativePath}`)
}

describe("bundle file codecs", () => {
  it("writes every fixture file back to the same bytes", () => {
    const files = listFixtureFiles(bundlesRoot)

    expect(files.length).toBeGreaterThanOrEqual(16)
    for (const relativePath of files) {
      const text = readFileSync(join(bundlesRoot, relativePath), "utf8")
      expect(roundTrip(relativePath, text), relativePath).toBe(text)
    }
  })

  it("reads an empty statements or beats file as an empty list", () => {
    expect(parseStatementsFile("", "statements.yaml")).toEqual([])
    expect(parseBeatsFile("[]\n", "beats.yaml")).toEqual([])
    expect(parseElementMemory("", "main.yaml")).toEqual({})
  })

  it("names the file when its YAML or its shape is wrong", () => {
    expect(() => parseStatementsFile("- {facet: traits", "character/elia.card/statements.yaml")).toThrow(
      /character\/elia\.card\/statements\.yaml/,
    )
    expect(() => parseElementCard("character", "kind: scene\n", "character/elia.card/card.yaml")).toThrow(BundleFileError)
    expect(() => parseBeatsFile("- 세라가 먼저 와 있다\n", "beats.yaml")).toThrow(BundleFileError)
    expect(() => parseElementMemory("voiceSample:\n  - {text: x, source: interview}\n", "main.yaml")).toThrow(BundleFileError)
    try {
      parseSceneStateFile("statements: [{facet: mood, value: x}]\n", "scene/002-rooftop.card/state.yaml")
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(BundleFileError)
      expect((error as BundleFileError).code).toBe("invalid-shape")
      expect((error as BundleFileError).fileName).toBe("scene/002-rooftop.card/state.yaml")
    }
  })
})

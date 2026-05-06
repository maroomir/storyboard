import { describe, expect, it } from "vitest"

import { buildSceneContext, type SceneContextWorkspaceFileSystem } from "../../../src/core/sceneContext"
import type { SceneFile } from "../../../src/shared/scene"
import { serializeCard } from "../../../src/files/card"
import type { BackgroundCard, CharacterCard } from "../../../src/shared/card"

const eliaCard: CharacterCard = {
  type: "character",
  id: "elia",
  name: "엘리아",
  role: "main"
}

const jihoonCard: CharacterCard = {
  type: "character",
  id: "jihoon",
  name: "지훈",
  role: "main"
}

const schoolBg: BackgroundCard = {
  type: "background",
  id: "school",
  name: "학교 정문",
  country: "한국"
}

class MockFileSystem implements SceneContextWorkspaceFileSystem {
  private readonly files = new Map<string, Uint8Array>()
  private readonly directories = new Map<string, [string, { type: "file" | "directory" }][]>()

  public setFile(path: string, content: string): void {
    this.files.set(path, new TextEncoder().encode(content))
  }

  public setDirectory(path: string, entries: [string, { type: "file" | "directory" }][]): void {
    this.directories.set(path, entries)
  }

  public async readFile(uri: unknown): Promise<Uint8Array> {
    const path = uri as string
    const content = this.files.get(path)

    if (!content) {
      throw new Error(`File not found: ${path}`)
    }

    return content
  }

  public async writeFile(): Promise<void> {
    throw new Error("Not implemented")
  }

  public async readDirectory(uri: unknown): Promise<[string, { type: "file" | "directory" }][]> {
    const path = uri as string
    const entries = this.directories.get(path)

    if (!entries) {
      throw new Error(`Directory not found: ${path}`)
    }

    return entries
  }
}

describe("sceneContext", () => {
  const mockPaths = {
    characterDirectory: "/mock/workspace/character",
    backgroundDirectory: "/mock/workspace/background",
    draftDirectory: "/mock/workspace/draft",
    joinPath: (base: unknown, ...segments: string[]): string => `${base as string}/${segments.join("/")}`
  }
  const mockScene: SceneFile = {
    stem: "01-prologue",
    order: 1,
    orderText: "01",
    slug: "prologue",
    frontmatter: {},
    body: "엘리아가 지훈에게 인사한다."
  }

  it("builds context with characters detected from body", async () => {
    const fileSystem = new MockFileSystem()

    fileSystem.setDirectory("/mock/workspace/character", [
      ["elia.card", { type: "file" }],
      ["jihoon.card", { type: "file" }],
      ["profile", { type: "directory" }]
    ])
    fileSystem.setDirectory("/mock/workspace/background", [])

    fileSystem.setFile("/mock/workspace/character/elia.card", serializeCard(eliaCard))
    fileSystem.setFile("/mock/workspace/character/jihoon.card", serializeCard(jihoonCard))

    const context = await buildSceneContext(mockPaths, mockScene, fileSystem)

    expect(context.scene).toEqual(mockScene)
    expect(context.characters).toHaveLength(2)
    expect(context.characters).toContainEqual(eliaCard)
    expect(context.characters).toContainEqual(jihoonCard)
    expect(context.background).toBeUndefined()
  })

  it("uses frontmatter.characters over body text when provided", async () => {
    const fileSystem = new MockFileSystem()

    fileSystem.setDirectory("/mock/workspace/character", [
      ["elia.card", { type: "file" }],
      ["jihoon.card", { type: "file" }]
    ])
    fileSystem.setDirectory("/mock/workspace/background", [])

    fileSystem.setFile("/mock/workspace/character/elia.card", serializeCard(eliaCard))
    fileSystem.setFile("/mock/workspace/character/jihoon.card", serializeCard(jihoonCard))

    const sceneWithFrontmatter: SceneFile = {
      ...mockScene,
      frontmatter: { characters: ["elia"] }
    }

    const context = await buildSceneContext(mockPaths, sceneWithFrontmatter, fileSystem)

    expect(context.characters).toHaveLength(1)
    expect(context.characters).toContainEqual(eliaCard)
  })

  it("resolves background from frontmatter.location", async () => {
    const fileSystem = new MockFileSystem()

    fileSystem.setDirectory("/mock/workspace/character", [])
    fileSystem.setDirectory("/mock/workspace/background", [["school.card", { type: "file" }]])

    fileSystem.setFile("/mock/workspace/background/school.card", serializeCard(schoolBg))

    const sceneWithLocation: SceneFile = {
      ...mockScene,
      frontmatter: { location: "school" }
    }

    const context = await buildSceneContext(mockPaths, sceneWithLocation, fileSystem)

    expect(context.background).toEqual(schoolBg)
  })

  it("ignores explicit sample card files when building context", async () => {
    const fileSystem = new MockFileSystem()
    const sampleCharacter: CharacterCard = {
      type: "character",
      id: "sample",
      name: "샘플 캐릭터"
    }
    const sampleBackground: BackgroundCard = {
      type: "background",
      id: "sample",
      name: "샘플 배경"
    }

    fileSystem.setDirectory("/mock/workspace/character", [
      [".sample.card", { type: "file" }],
      ["elia.card", { type: "file" }]
    ])
    fileSystem.setDirectory("/mock/workspace/background", [
      [".sample.card", { type: "file" }],
      ["school.card", { type: "file" }]
    ])

    fileSystem.setFile("/mock/workspace/character/.sample.card", serializeCard(sampleCharacter))
    fileSystem.setFile("/mock/workspace/character/elia.card", serializeCard(eliaCard))
    fileSystem.setFile("/mock/workspace/background/.sample.card", serializeCard(sampleBackground))
    fileSystem.setFile("/mock/workspace/background/school.card", serializeCard(schoolBg))

    const sceneWithSampleReferences: SceneFile = {
      ...mockScene,
      frontmatter: {
        characters: ["sample", "elia"],
        location: "sample"
      },
      body: "샘플 캐릭터와 엘리아가 학교 정문에 있다."
    }

    const context = await buildSceneContext(mockPaths, sceneWithSampleReferences, fileSystem)

    expect(context.characters).toEqual([eliaCard])
    expect(context.background).toBeUndefined()
  })

  it("handles missing directories gracefully", async () => {
    const fileSystem = new MockFileSystem()

    const context = await buildSceneContext(mockPaths, mockScene, fileSystem)

    expect(context.characters).toEqual([])
    expect(context.background).toBeUndefined()
  })
})

describe("readPreviousSceneContext", () => {
  const mockPaths = {
    characterDirectory: "/mock/workspace/character",
    backgroundDirectory: "/mock/workspace/background",
    draftDirectory: "/mock/workspace/draft",
    joinPath: (base: unknown, ...segments: string[]): string => `${base as string}/${segments.join("/")}`
  }

  it("returns undefined for the first scene (order 1)", async () => {
    const fileSystem = new MockFileSystem()
    const context = await import("../../../src/core/sceneContext").then((m) =>
      m.readPreviousSceneContext(mockPaths, 1, fileSystem)
    )
    expect(context).toBeUndefined()
  })

  it("reads the last 1000 characters of the previous draft file", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setDirectory("/mock/workspace/draft", [
      ["01-prologue.md", { type: "file" }],
      ["02-chapter-1.md", { type: "file" }]
    ])

    const longText = "A".repeat(2000) + "이전 씬의 마지막 문장입니다."
    fileSystem.setFile("/mock/workspace/draft/01-prologue.md", longText)

    const context = await import("../../../src/core/sceneContext").then((m) =>
      m.readPreviousSceneContext(mockPaths, 2, fileSystem)
    )

    expect(context).toBeDefined()
    expect(context?.length).toBeLessThanOrEqual(1000)
    expect(context).toContain("이전 씬의 마지막 문장입니다.")
  })

  it("returns undefined if previous draft file is missing", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setDirectory("/mock/workspace/draft", [
      ["02-chapter-1.md", { type: "file" }]
    ])

    const context = await import("../../../src/core/sceneContext").then((m) =>
      m.readPreviousSceneContext(mockPaths, 3, fileSystem)
    )

    expect(context).toBeUndefined()
  })
})

import { describe, expect, it } from "vitest"

import {
  buildNarrativeContext,
  buildSceneContext,
  type SceneContext,
  type SceneContextWorkspaceFileSystem
} from "@/core/sceneContext"
import type { SceneFile } from "@/shared/scene"
import { serializeCard } from "@/files/card"
import { serializeBible } from "@/files/bible"
import type { StoryBible } from "@/shared/bible"
import type { BackgroundCard, CharacterCard } from "@/shared/card"

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
  type: "location",
  id: "school",
  name: "학교 정문",
  locationKind: "place",
  description: "",
  characterIds: [],
  tags: []
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
      type: "location",
      id: "sample",
      name: "샘플 배경",
      locationKind: "place",
      description: "",
      characterIds: [],
      tags: []
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
    const context = await import("@/core/sceneContext.js").then((m) =>
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

    const context = await import("@/core/sceneContext.js").then((m) =>
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

    const context = await import("@/core/sceneContext.js").then((m) =>
      m.readPreviousSceneContext(mockPaths, 3, fileSystem)
    )

    expect(context).toBeUndefined()
  })
})

describe("buildNarrativeContext", () => {
  const biblePath = "/mock/workspace/.storyboard/bible/canon.yaml"
  const basePaths = {
    characterDirectory: "/mock/workspace/character",
    backgroundDirectory: "/mock/workspace/background",
    draftDirectory: "/mock/workspace/draft",
    joinPath: (base: unknown, ...segments: string[]): string => `${base as string}/${segments.join("/")}`
  }
  const firstScene: SceneFile = {
    stem: "01-prologue",
    order: 1,
    orderText: "01",
    slug: "prologue",
    frontmatter: {},
    body: "엘리아가 지훈에게 인사한다."
  }
  const context: SceneContext = { scene: firstScene, characters: [eliaCard, jihoonCard] }
  const bible: StoryBible = {
    version: "1.0.0",
    facts: [
      { id: "f1", subject: { kind: "character", id: "elia" }, key: "눈동자 색", value: "녹색", status: "canon" },
      { id: "f2", subject: { kind: "character", id: "elia" }, key: "비밀", value: "왕족", status: "candidate" }
    ]
  }

  it("injects canon bible facts for scene entities", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(biblePath, serializeBible(bible))

    const result = await buildNarrativeContext({ ...basePaths, bibleCanon: biblePath }, context, fileSystem)

    expect(result.bibleFacts.map((fact) => fact.id)).toEqual(["f1"])
    expect(result.prompt).toContain("[설정 메모]")
    expect(result.prompt).toContain("엘리아 — 눈동자 색: 녹색")
    expect(result.prompt).not.toContain("왕족")
  })

  it("returns no facts or prompt when bible and previous context are absent", async () => {
    const fileSystem = new MockFileSystem()

    const result = await buildNarrativeContext(basePaths, context, fileSystem)

    expect(result.bibleFacts).toEqual([])
    expect(result.prompt).toBeUndefined()
  })

  it("injects the time-valid arm version for the scene's order", async () => {
    const armBible: StoryBible = {
      version: "1.0.0",
      facts: [
        { id: "arm-a", subject: { kind: "character", id: "elia" }, key: "팔", value: "멀쩡함", status: "canon", validUntil: "03-x" },
        { id: "arm-b", subject: { kind: "character", id: "elia" }, key: "팔", value: "의수", status: "canon", validFrom: "04-x" }
      ]
    }
    const sceneAt = (order: number): SceneFile => ({
      stem: `${String(order).padStart(2, "0")}-scene`,
      order,
      orderText: String(order).padStart(2, "0"),
      slug: "scene",
      frontmatter: {},
      body: "엘리아가 지훈에게 인사한다."
    })

    const fileSystem = new MockFileSystem()
    fileSystem.setFile(biblePath, serializeBible(armBible))

    const beforeContext: SceneContext = { scene: sceneAt(2), characters: [eliaCard] }
    const before = await buildNarrativeContext({ ...basePaths, bibleCanon: biblePath }, beforeContext, fileSystem)

    expect(before.bibleFacts.map((fact) => fact.id)).toEqual(["arm-a"])
    expect(before.prompt).toContain("멀쩡함")
    expect(before.prompt).not.toContain("의수")

    const afterContext: SceneContext = { scene: sceneAt(6), characters: [eliaCard] }
    const after = await buildNarrativeContext({ ...basePaths, bibleCanon: biblePath }, afterContext, fileSystem)

    expect(after.bibleFacts.map((fact) => fact.id)).toEqual(["arm-b"])
    expect(after.prompt).toContain("의수")
    expect(after.prompt).not.toContain("멀쩡함")
  })
})

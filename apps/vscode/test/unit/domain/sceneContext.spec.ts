import { describe, expect, it } from "vitest"

import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  resolveSceneBibleFacts,
  serializeBible,
  serializeCard
} from '@storyboard/story-format';
import type { BackgroundCard, CharacterCard, SceneContext, SceneContextWorkspaceFileSystem, SceneFile, StoryBible } from '@storyboard/story-format';
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
  description: [],
  characterIds: [],
  tags: []
}

class MockFileSystem implements SceneContextWorkspaceFileSystem {
  private readonly files = new Map<string, Uint8Array>()
  private readonly directories = new Map<string, [string, { type: "file" | "directory" }][]>()

  public writeCount = 0

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
    this.writeCount += 1
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

  it("detects a character by alias when the name is absent from the body", async () => {
    const fileSystem = new MockFileSystem()
    const manjaeCard: CharacterCard = {
      type: "character",
      id: "manjae",
      name: "조만재",
      role: "main",
      aliases: ["만재"]
    }

    fileSystem.setDirectory("/mock/workspace/character", [["manjae.card", { type: "file" }]])
    fileSystem.setDirectory("/mock/workspace/background", [])
    fileSystem.setFile("/mock/workspace/character/manjae.card", serializeCard(manjaeCard))

    const aliasScene: SceneFile = { ...mockScene, body: "만재가 문을 박차고 들어왔다." }

    const context = await buildSceneContext(mockPaths, aliasScene, fileSystem)

    expect(context.characters).toEqual([manjaeCard])
  })

  it("detects a character by gamename attribute when name and aliases are absent", async () => {
    const fileSystem = new MockFileSystem()
    const doyunCard: CharacterCard = {
      type: "character",
      id: "doyun",
      name: "강도윤",
      role: "supporting",
      attributes: { gamename: "발키리" }
    }

    fileSystem.setDirectory("/mock/workspace/character", [["doyun.card", { type: "file" }]])
    fileSystem.setDirectory("/mock/workspace/background", [])
    fileSystem.setFile("/mock/workspace/character/doyun.card", serializeCard(doyunCard))

    const gamenameScene: SceneFile = { ...mockScene, body: "발키리 일행이 경매홀에 들어섰다." }

    const context = await buildSceneContext(mockPaths, gamenameScene, fileSystem)

    expect(context.characters).toEqual([doyunCard])
  })

  it("excludes a character whose name and aliases are both absent from the body", async () => {
    const fileSystem = new MockFileSystem()
    const manjaeCard: CharacterCard = {
      type: "character",
      id: "manjae",
      name: "조만재",
      role: "main",
      aliases: ["만재"]
    }

    fileSystem.setDirectory("/mock/workspace/character", [["manjae.card", { type: "file" }]])
    fileSystem.setDirectory("/mock/workspace/background", [])
    fileSystem.setFile("/mock/workspace/character/manjae.card", serializeCard(manjaeCard))

    const absentScene: SceneFile = { ...mockScene, body: "엘리아가 혼자 걷는다." }

    const context = await buildSceneContext(mockPaths, absentScene, fileSystem)

    expect(context.characters).toEqual([])
  })

  it("still detects by name when no aliases are set", async () => {
    const fileSystem = new MockFileSystem()

    fileSystem.setDirectory("/mock/workspace/character", [["elia.card", { type: "file" }]])
    fileSystem.setDirectory("/mock/workspace/background", [])
    fileSystem.setFile("/mock/workspace/character/elia.card", serializeCard(eliaCard))

    const nameScene: SceneFile = { ...mockScene, body: "엘리아가 창밖을 본다." }

    const context = await buildSceneContext(mockPaths, nameScene, fileSystem)

    expect(context.characters).toEqual([eliaCard])
  })

  it("uses frontmatter.characters over alias detection when provided", async () => {
    const fileSystem = new MockFileSystem()
    const manjaeCard: CharacterCard = {
      type: "character",
      id: "manjae",
      name: "조만재",
      role: "main",
      aliases: ["만재"]
    }

    fileSystem.setDirectory("/mock/workspace/character", [
      ["manjae.card", { type: "file" }],
      ["elia.card", { type: "file" }]
    ])
    fileSystem.setDirectory("/mock/workspace/background", [])
    fileSystem.setFile("/mock/workspace/character/manjae.card", serializeCard(manjaeCard))
    fileSystem.setFile("/mock/workspace/character/elia.card", serializeCard(eliaCard))

    const frontmatterScene: SceneFile = {
      ...mockScene,
      frontmatter: { characters: ["elia"] },
      body: "만재가 문을 박차고 들어왔다."
    }

    const context = await buildSceneContext(mockPaths, frontmatterScene, fileSystem)

    expect(context.characters).toEqual([eliaCard])
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

  it("auto-detects a background by alias when frontmatter.location is absent", async () => {
    const fileSystem = new MockFileSystem()
    const aliasedSchoolBg: BackgroundCard = { ...schoolBg, aliases: ["학교", "교문"] }

    fileSystem.setDirectory("/mock/workspace/character", [])
    fileSystem.setDirectory("/mock/workspace/background", [["school.card", { type: "file" }]])
    fileSystem.setFile("/mock/workspace/background/school.card", serializeCard(aliasedSchoolBg))

    const sceneInSchool: SceneFile = { ...mockScene, body: "교문 앞에서 엘리아가 기다린다." }

    const context = await buildSceneContext(mockPaths, sceneInSchool, fileSystem)

    expect(context.background).toEqual(aliasedSchoolBg)
  })

  it("prefers the background whose matched token is most specific", async () => {
    const fileSystem = new MockFileSystem()
    const cityBg: BackgroundCard = {
      type: "location",
      id: "city",
      name: "도시",
      locationKind: "place",
      description: [],
      characterIds: [],
      tags: []
    }
    const aliasedSchoolBg: BackgroundCard = { ...schoolBg, aliases: ["학교"] }

    fileSystem.setDirectory("/mock/workspace/character", [])
    fileSystem.setDirectory("/mock/workspace/background", [
      ["city.card", { type: "file" }],
      ["school.card", { type: "file" }]
    ])
    fileSystem.setFile("/mock/workspace/background/city.card", serializeCard(cityBg))
    fileSystem.setFile("/mock/workspace/background/school.card", serializeCard(aliasedSchoolBg))

    const sceneInSchool: SceneFile = { ...mockScene, body: "도시의 학교 정문 앞에서 만났다." }

    const context = await buildSceneContext(mockPaths, sceneInSchool, fileSystem)

    expect(context.background).toEqual(aliasedSchoolBg)
  })

  it("leaves background undefined when no background matches the body", async () => {
    const fileSystem = new MockFileSystem()
    const aliasedSchoolBg: BackgroundCard = { ...schoolBg, aliases: ["학교", "교문"] }

    fileSystem.setDirectory("/mock/workspace/character", [])
    fileSystem.setDirectory("/mock/workspace/background", [["school.card", { type: "file" }]])
    fileSystem.setFile("/mock/workspace/background/school.card", serializeCard(aliasedSchoolBg))

    const sceneElsewhere: SceneFile = { ...mockScene, body: "엘리아가 바닷가를 걷는다." }

    const context = await buildSceneContext(mockPaths, sceneElsewhere, fileSystem)

    expect(context.background).toBeUndefined()
  })

  it("prefers frontmatter.location over body auto-detection", async () => {
    const fileSystem = new MockFileSystem()
    const aliasedSchoolBg: BackgroundCard = { ...schoolBg, aliases: ["학교", "교문"] }
    const harborBg: BackgroundCard = {
      type: "location",
      id: "harbor",
      name: "항구",
      locationKind: "place",
      description: [],
      characterIds: [],
      tags: []
    }

    fileSystem.setDirectory("/mock/workspace/character", [])
    fileSystem.setDirectory("/mock/workspace/background", [
      ["school.card", { type: "file" }],
      ["harbor.card", { type: "file" }]
    ])
    fileSystem.setFile("/mock/workspace/background/school.card", serializeCard(aliasedSchoolBg))
    fileSystem.setFile("/mock/workspace/background/harbor.card", serializeCard(harborBg))

    const sceneWithLocation: SceneFile = {
      ...mockScene,
      frontmatter: { location: "harbor" },
      body: "교문 앞에서 엘리아가 기다린다."
    }

    const context = await buildSceneContext(mockPaths, sceneWithLocation, fileSystem)

    expect(context.background).toEqual(harborBg)
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
      description: [],
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
    chapterSummaries: "/mock/workspace/.storyboard/memory/summaries.md",
    joinPath: (base: unknown, ...segments: string[]): string => `${base as string}/${segments.join("/")}`
  }

  it("returns undefined for the first scene (order 1)", async () => {
    const fileSystem = new MockFileSystem()
    const context = await import("@storyboard/story-format").then((m) =>
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

    const context = await import("@storyboard/story-format").then((m) =>
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

    const context = await import("@storyboard/story-format").then((m) =>
      m.readPreviousSceneContext(mockPaths, 3, fileSystem)
    )

    expect(context).toBeUndefined()
  })
})

describe("readPreviousSceneContext rolling summary", () => {
  const summaryPath = "/mock/workspace/.storyboard/memory/summaries.md"
  const mockPaths = {
    characterDirectory: "/mock/workspace/character",
    backgroundDirectory: "/mock/workspace/background",
    draftDirectory: "/mock/workspace/draft",
    chapterSummaries: summaryPath,
    joinPath: (base: unknown, ...segments: string[]): string => `${base as string}/${segments.join("/")}`
  }

  const setDraftTail = (fileSystem: MockFileSystem, marker: string): void => {
    fileSystem.setDirectory("/mock/workspace/draft", [
      ["01-prologue.md", { type: "file" }],
      ["02-chapter-1.md", { type: "file" }]
    ])
    fileSystem.setFile("/mock/workspace/draft/01-prologue.md", "A".repeat(50) + marker)
  }

  const readPrevious = (
    paths: typeof mockPaths | Omit<typeof mockPaths, "chapterSummaries">,
    order: number,
    fileSystem: MockFileSystem
  ): Promise<string | undefined> =>
    import("@storyboard/story-format").then((m) => m.readPreviousSceneContext(paths, order, fileSystem))

  it("QAS-C6-01: prefers the rolling summary over the previous draft tail", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(summaryPath, "rolling state with SUMMARY-MARKER inside")
    setDraftTail(fileSystem, "TAIL-MARKER")

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result).toContain("SUMMARY-MARKER")
    expect(result).not.toContain("TAIL-MARKER")
  })

  it("QAS-C6-02: returns undefined for the first scene even when a summary exists", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(summaryPath, "SUMMARY-MARKER for an existing summary")

    const result = await readPrevious(mockPaths, 1, fileSystem)

    expect(result).toBeUndefined()
  })

  it("QAS-C6-03: falls back to the 1000-char tail when the summary file is absent", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setDirectory("/mock/workspace/draft", [
      ["01-prologue.md", { type: "file" }],
      ["02-chapter-1.md", { type: "file" }]
    ])
    const longTail = "A".repeat(2000) + "TAIL-MARKER"
    fileSystem.setFile("/mock/workspace/draft/01-prologue.md", longTail)

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result).toBeDefined()
    expect(result?.length).toBeLessThanOrEqual(1000)
    expect(result).toContain("TAIL-MARKER")
  })

  it("QAS-C6-04: treats a whitespace-only summary as absent and falls to the tail", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(summaryPath, "   \n   ")
    setDraftTail(fileSystem, "TAIL-MARKER")

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result).toContain("TAIL-MARKER")
    expect(result).not.toBe("")
  })

  it("QAS-C6-05: caps an over-budget summary with no chapter sections to its tail", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(summaryPath, "HEAD-MARKER" + "x".repeat(9000) + "TAIL-MARKER")
    setDraftTail(fileSystem, "DRAFT-TAIL-MARKER")

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result).toBeDefined()
    expect(result?.length).toBeLessThanOrEqual(8000)
    expect(result?.length).toBeGreaterThanOrEqual(1000)
    expect(result).toContain("TAIL-MARKER")
    expect(result).not.toContain("HEAD-MARKER")
  })

  it("QAS-C6-06: keeps at least 1000 chars (improvement over the old tail)", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(summaryPath, "y".repeat(2500))

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result?.length).toBeGreaterThanOrEqual(1000)
  })

  it("QAS-C6-07: returns the whole trimmed file when length equals the budget", async () => {
    const fileSystem = new MockFileSystem()
    const wholeSummary = "z".repeat(8000)
    fileSystem.setFile(summaryPath, wholeSummary)

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result).toBe(wholeSummary)
    expect(result?.length).toBe(8000)
  })

  it("QAS-C6-08: returns the trailing 8000 chars when length is just over the budget", async () => {
    const fileSystem = new MockFileSystem()
    const overBudget = "w".repeat(8001)
    fileSystem.setFile(summaryPath, overBudget)

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result?.length).toBe(8000)
    expect(result).toBe(overBudget.slice(-8000))
  })

  it("QAS-C6-08a: compresses the oldest chapters instead of cutting the opening", async () => {
    const fileSystem = new MockFileSystem()
    const chapter = (title: string, marker: string): string =>
      `## ${title}\n\n${marker}\n${"d".repeat(3000)}\n\n`
    fileSystem.setFile(
      summaryPath,
      `# 장별 요약\n\n${chapter("1장", "OPENING-MARKER")}${chapter("2장", "MIDDLE-MARKER")}${chapter("3장", "LATEST-MARKER")}`,
    )

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result?.length).toBeLessThanOrEqual(8000)
    // The opening chapter survives as its heading plus one line; the latest keeps its detail.
    expect(result).toContain("## 1장")
    expect(result).toContain("OPENING-MARKER")
    expect(result).toContain("LATEST-MARKER")
    expect(result).toContain("d".repeat(3000))
  })

  it("QAS-C6-11: drops a chapter marked stale so its discarded events are not injected", async () => {
    const fileSystem = new MockFileSystem()
    const stale = `## 1장\n\n<!-- chapter-input: sha256:old stale -->\n\nSTALE-MARKER\n\n`
    const fresh = `## 2장\n\n<!-- chapter-input: sha256:new -->\n\nFRESH-MARKER\n`
    fileSystem.setFile(summaryPath, `# 장별 요약\n\n${stale}${fresh}`)
    setDraftTail(fileSystem, "TAIL-MARKER")

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result).toContain("FRESH-MARKER")
    expect(result).not.toContain("STALE-MARKER")
  })

  it("QAS-C6-12: falls back to the draft tail when every chapter is stale", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(
      summaryPath,
      `# 장별 요약\n\n## 1장\n\n<!-- chapter-input: sha256:old stale -->\n\nSTALE-MARKER\n`
    )
    setDraftTail(fileSystem, "TAIL-MARKER")

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result).toContain("TAIL-MARKER")
    expect(result).not.toContain("STALE-MARKER")
  })

  it("QAS-C6-09: falls back to the tail when the summary read is unreadable", async () => {
    const fileSystem = new MockFileSystem()
    setDraftTail(fileSystem, "TAIL-MARKER")

    const result = await readPrevious(mockPaths, 2, fileSystem)

    expect(result).toContain("TAIL-MARKER")
  })

  it("QAS-C6-10: skips the summary entirely when no path member is present", async () => {
    const fileSystem = new MockFileSystem()
    const { chapterSummaries, ...pathsWithoutSummary } = mockPaths
    void chapterSummaries
    fileSystem.setFile(summaryPath, "SUMMARY-MARKER should be ignored without a path member")
    setDraftTail(fileSystem, "TAIL-MARKER")

    const result = await readPrevious(pathsWithoutSummary, 2, fileSystem)

    expect(result).toContain("TAIL-MARKER")
    expect(result).not.toContain("SUMMARY-MARKER")
  })

  it("QAS-C6-13: never writes on the read path", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(summaryPath, "rolling state with SUMMARY-MARKER inside")

    await readPrevious(mockPaths, 2, fileSystem)

    expect(fileSystem.writeCount).toBe(0)
  })

  it("QAS-C6-14: returns identical results across repeated reads", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(summaryPath, "rolling state with DETERMINISM-MARKER inside")

    const first = await readPrevious(mockPaths, 2, fileSystem)
    const second = await readPrevious(mockPaths, 2, fileSystem)

    expect(first).toBe(second)
  })
})

describe("buildNarrativeContext", () => {
  const biblePath = "/mock/workspace/.storyboard/bible/canon.yaml"
  const summaryPath = "/mock/workspace/.storyboard/memory/summaries.md"
  const basePaths = {
    characterDirectory: "/mock/workspace/character",
    backgroundDirectory: "/mock/workspace/background",
    draftDirectory: "/mock/workspace/draft",
    chapterSummaries: summaryPath,
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
    expect(result.prompt).toContain("작가 참고용 배경지식")
    expect(result.prompt).not.toContain("왕족")
  })

  it("injects the story state ledger ahead of the setting memo", async () => {
    const statePath = "/mock/workspace/.storyboard/cache/storyState.md"
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(biblePath, serializeBible(bible))
    fileSystem.setFile(
      statePath,
      "# 이야기 상태\n<!-- through-scene: 1 -->\n## 살아 있는 모티프\n- \"오늘도… 손님이 오실 줄 알았습니다\"\n"
    )

    const secondScene: SceneFile = { ...firstScene, order: 2, orderText: "02" }
    const secondContext: SceneContext = { scene: secondScene, characters: [eliaCard, jihoonCard] }

    const result = await buildNarrativeContext(
      { ...basePaths, bibleCanon: biblePath, storyState: statePath },
      secondContext,
      fileSystem
    )

    expect(result.prompt).toContain("[이야기 상태]")
    expect(result.prompt).toContain("손님이 오실 줄 알았습니다")
    expect(result.prompt?.indexOf("[이야기 상태]")).toBeLessThan(result.prompt?.indexOf("[설정 메모]") ?? -1)
  })

  it("skips the story state ledger for the first scene", async () => {
    const statePath = "/mock/workspace/.storyboard/cache/storyState.md"
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(statePath, "# 이야기 상태\n## 확정 사실\n- 나중 씬의 상태\n")

    const result = await buildNarrativeContext(
      { ...basePaths, storyState: statePath },
      context,
      fileSystem
    )

    expect(result.prompt ?? "").not.toContain("[이야기 상태]")
  })

  it("strips foreign-script contamination from the previous-scene tail", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setDirectory("/mock/workspace/draft", [["01-prev.md", { type: "file" }]])
    fileSystem.setFile("/mock/workspace/draft/01-prev.md", "지금은 다음 ضرب을 정하지 못한 채 멈춰 있었다.")

    const secondScene: SceneFile = { ...firstScene, order: 2, orderText: "02" }
    const secondContext: SceneContext = { scene: secondScene, characters: [eliaCard, jihoonCard] }

    const result = await buildNarrativeContext(
      { ...basePaths, chapterSummaries: undefined },
      secondContext,
      fileSystem
    )

    expect(result.prompt).toContain("정하지 못한 채")
    expect(result.prompt).not.toContain("ضرب")
  })

  it("returns no facts or prompt when bible and previous context are absent", async () => {
    const fileSystem = new MockFileSystem()

    const result = await buildNarrativeContext(basePaths, context, fileSystem)

    expect(result.bibleFacts).toEqual([])
    expect(result.prompt).toBeUndefined()
  })

  it("QAS-C6-11: renders the rolling summary under [이전 장면]", async () => {
    const fileSystem = new MockFileSystem()
    fileSystem.setFile(summaryPath, "rolling state with SUMMARY-MARKER inside")

    const secondScene: SceneFile = { ...firstScene, order: 2, orderText: "02" }
    const secondContext: SceneContext = { scene: secondScene, characters: [eliaCard, jihoonCard] }

    const result = await buildNarrativeContext(basePaths, secondContext, fileSystem)

    expect(result.prompt).toContain("[이전 장면]")
    expect(result.prompt).toContain("SUMMARY-MARKER")
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

describe("scene bible facts with a story time axis", () => {
  const scenePaths = {
    characterDirectory: "/mock/workspace/character",
    sceneDirectory: "/mock/workspace/scene",
    backgroundDirectory: "/mock/workspace/background",
    draftDirectory: "/mock/workspace/draft",
    bibleCanon: "/mock/workspace/.storyboard/bible/canon.yaml",
    joinPath: (base: unknown, ...segments: string[]): string =>
      `${base as string}/${segments.join("/")}`
  }

  const rangedBible: StoryBible = {
    version: "1.0.0",
    facts: [
      {
        id: "alive",
        subject: { kind: "character", id: "elia" },
        key: "상태",
        value: "살아 있다",
        status: "canon",
        validUntil: 20
      },
      {
        id: "dead",
        subject: { kind: "character", id: "elia" },
        key: "상태",
        value: "죽었다",
        status: "canon",
        validFrom: 21
      }
    ]
  }

  function workspace(storyTimeLine: string): MockFileSystem {
    const fileSystem = new MockFileSystem()

    fileSystem.setDirectory("/mock/workspace/character", [["elia.card", { type: "file" }]])
    fileSystem.setDirectory("/mock/workspace/background", [])
    fileSystem.setFile("/mock/workspace/character/elia.card", serializeCard(eliaCard))
    fileSystem.setFile(scenePaths.bibleCanon, serializeBible(rangedBible))
    fileSystem.setDirectory("/mock/workspace/scene", [["25-memory.card", { type: "file" }]])
    fileSystem.setFile(
      "/mock/workspace/scene/25-memory.card",
      `type: scene\nid: 25-memory\n${storyTimeLine}summary: 엘리아를 떠올린다.\n`
    )

    return fileSystem
  }

  const flashbackScene: SceneFile = {
    stem: "25-memory",
    order: 25,
    orderText: "25",
    slug: "memory",
    frontmatter: {},
    body: "엘리아를 떠올린다."
  }

  async function resolveIds(fileSystem: MockFileSystem): Promise<string[]> {
    const context = await buildSceneContext(scenePaths, flashbackScene, fileSystem)
    const facts = await resolveSceneBibleFacts(scenePaths, context, fileSystem)

    return facts.map((fact) => fact.id)
  }

  it("reads the flashback's story time from its scene card", async () => {
    expect(await resolveIds(workspace("storyTime: 3\n"))).toEqual(["alive"])
  })

  it("falls back to the scene order when no scene declares a story time", async () => {
    expect(await resolveIds(workspace(""))).toEqual(["dead"])
  })
})

describe("formatBibleFactLines with a per-character reveal", () => {
  const context: SceneContext = {
    scene: {
      stem: "12-reveal",
      order: 12,
      orderText: "12",
      slug: "reveal",
      frontmatter: {},
      body: "엘리아와 지훈이 마주 앉는다."
    },
    characters: [eliaCard, jihoonCard]
  }

  it("names the characters who do not know the revealed fact yet", () => {
    const lines = formatBibleFactLines(context, [
      {
        id: "twist",
        subject: { kind: "character", id: "elia" },
        key: "정체",
        value: "관리자",
        status: "canon",
        revealFrom: { scene: 10, knownBy: ["elia"] }
      }
    ])

    expect(lines).toEqual(["엘리아 — 정체: 관리자 (아직 모름: 지훈)"])
  })

  it("adds no marker when every character in the scene knows", () => {
    const lines = formatBibleFactLines(context, [
      {
        id: "twist",
        subject: { kind: "character", id: "elia" },
        key: "정체",
        value: "관리자",
        status: "canon",
        revealFrom: { scene: 10, knownBy: ["elia", "jihoon"] }
      }
    ])

    expect(lines).toEqual(["엘리아 — 정체: 관리자"])
  })

  it("adds no marker when the fact carries no knownBy list", () => {
    const lines = formatBibleFactLines(context, [
      {
        id: "eye",
        subject: { kind: "character", id: "elia" },
        key: "눈",
        value: "녹색",
        status: "canon",
        revealFrom: 10
      }
    ])

    expect(lines).toEqual(["엘리아 — 눈: 녹색"])
  })
})

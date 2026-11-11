import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import {
  formatStoryStateForPrompt,
  getStoryboardProjectPaths,
  joinStoryPath,
  resolveThreadPaths,
  serializeStoryState,
  type SceneFile,
  type StoryState
} from "@storyboard/story-model"
import { StoryLedger, type FileSystemDirectoryEntry, type IFileSystem } from "@storyboard/story-engine"
import {
  StoryMemoryAuditor,
} from "../../../../../../packages/story-engine/src/application/drafts/storyMemoryAuditor"
import { StoryStateRecorder, toStoryStateEntries } from "../../../../../../packages/story-engine/src/application/drafts/updateStoryState"
import { legacyCards, stubCards } from "../../../stubs/cards"
import { legacyScenesUnder, stubScenes, type StubSceneStates } from "../../../stubs/scenes"

class MemoryWorkspace implements IFileSystem {
  private readonly files = new Map<string, string>()

  public write(path: string, content: string): void {
    this.files.set(path, content)
  }

  public remove(path: string): void {
    this.files.delete(path)
  }

  public async readFile(uri: { path: string }): Promise<Uint8Array> {
    const content = this.files.get(uri.path)

    if (content === undefined) {
      throw new Error(`ENOENT: ${uri.path}`)
    }

    return new TextEncoder().encode(content)
  }

  public async writeFile(uri: { path: string }, content: Uint8Array): Promise<void> {
    this.files.set(uri.path, new TextDecoder().decode(content))
  }

  public read(path: string): string | undefined {
    return this.files.get(path)
  }

  public async createDirectory(): Promise<void> {}

  public async exists(uri: { path: string }): Promise<boolean> {
    return this.files.has(uri.path)
  }

  public async listFileNames(uri: { path: string }): Promise<string[]> {
    return (await this.readDirectory(uri)).map(([name]) => name)
  }

  public async readDirectory(uri: { path: string }): Promise<FileSystemDirectoryEntry[]> {
    const prefix = `${uri.path}/`
    const names = [...this.files.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => path.slice(prefix.length))

    if (names.length === 0) {
      throw new Error(`ENOENT: ${uri.path}`)
    }

    return names.map((name) => [name, { type: "file" as const }])
  }

  public async delete(uri: { path: string }): Promise<void> {
    this.files.delete(uri.path)
  }

  public async modifiedTime(): Promise<number> {
    return 0
  }

  public async isRealPathInside(): Promise<boolean> {
    return true
  }
}

const workspaceRoot = vscode.Uri.file("/ws")
const paths = getStoryboardProjectPaths(workspaceRoot as never)
const sceneStems: Readonly<Record<number, string>> = { 1: "01-first", 2: "02-second", 3: "03-third" }

function sceneCard(order: string, slug: string, summary: string, extra: readonly string[] = []): string {
  return ["type: scene", `id: ${order}-${slug}`, "characters:", "  - jina", `summary: ${summary}`, ...extra, ""].join("\n")
}

function characterCard(description: string): string {
  return ["type: character", "id: jina", "name: 진아", "role: main", "description:", `  - ${description}`, ""].join(
    "\n"
  )
}

let fileSystem: MemoryWorkspace
let states: StubSceneStates

function workspaceCards(): ReturnType<typeof legacyCards> {
  return legacyCards(fileSystem, {
    characterDirectory: paths.characterDirectory,
    backgroundDirectory: paths.backgroundDirectory,
    joinPath: (base: never, ...segments: string[]) => joinStoryPath(base, ...segments)
  })
}

function workspaceScenes(): ReturnType<typeof legacyScenesUnder> {
  return legacyScenesUnder(fileSystem, paths.workspaceRoot, undefined, states)
}

function seedLedger(entries: readonly { order: number; hash?: string }[]): void {
  for (const entry of entries) {
    states.set(sceneStems[entry.order] as string, {
      ...(entry.hash === undefined ? {} : { inputHash: entry.hash }),
      statements: [{ facet: "event", value: `${entry.order}화 사실` }]
    })
  }
}

async function readLedger(threadId: string = "main"): Promise<StoryState> {
  return await new StoryLedger({ scenes: workspaceScenes(), cards: workspaceCards() }).read(
    paths.workspaceRoot,
    threadId
  )
}

async function ledgerText(threadId: string = "main"): Promise<string> {
  return serializeStoryState(await readLedger(threadId))
}

function auditRequest(beforeSceneOrder?: number, threadId?: string): never {
  return {
    fileSystem,
    cards: workspaceCards(),
    scenes: workspaceScenes(),
    paths: threadId === undefined ? paths : resolveThreadPaths(paths, threadId),
    format: "novel",
    sceneBreakJoiner: undefined,
    ...(beforeSceneOrder === undefined ? {} : { beforeSceneOrder })
  } as never
}

async function sealedLedger(orders: readonly number[]): Promise<{ order: number; hash: string }[]> {
  seedLedger(orders.map((order) => ({ order })))
  await new StoryMemoryAuditor(auditRequest()).seal()
  const sealed: StoryState = await readLedger()
  states.clear()

  return orders.map((order) => {
    const hash: string | undefined = sealed.sceneInputHashes.get(order)
    if (hash === undefined) {
      throw new Error(`씬 ${order}의 봉인 해시를 얻지 못했습니다.`)
    }
    return { order, hash }
  })
}

describe("StoryMemoryAuditor.audit", () => {
  beforeEach(() => {
    fileSystem = new MemoryWorkspace()
    states = new Map()
    fileSystem.write("/ws/character/jina.card", characterCard("방송부 2학년"))
    fileSystem.write("/ws/scene/01-first.card", sceneCard("01", "first", "첫 방송을 마친다."))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "익명 사연이 도착한다."))
    fileSystem.write("/ws/scene/03-third.card", sceneCard("03", "third", "복도에서 원고를 줍는다."))
  })

  it("reports an unsealed ledger instead of calling it stale", async () => {
    seedLedger([{ order: 1 }, { order: 2 }])

    const result = await new StoryMemoryAuditor(auditRequest()).audit()

    expect(result.audit.staleSceneOrders).toEqual([])
    expect(result.audit.unsealedSceneOrders).toEqual([1, 2])
    expect(result.staleWarning).toBeUndefined()
    expect(result.needsMarking).toBe(false)
  })

  it("finds nothing stale while every scene still hashes the same", async () => {
    seedLedger(await sealedLedger([1, 2, 3]))

    const result = await new StoryMemoryAuditor(auditRequest()).audit()

    expect(result.audit.staleSceneOrders).toEqual([])
    expect(result.needsMarking).toBe(false)
  })

  it("marks the scenes whose cards changed after the ledger was written", async () => {
    seedLedger(await sealedLedger([1, 2, 3]))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "고쳐 쓴 요약."))

    const result = await new StoryMemoryAuditor(auditRequest(3)).audit()

    expect(result.audit.staleSceneOrders).toEqual([2])
    expect(result.staleWarning).toContain("씬 2")
    expect(result.needsMarking).toBe(true)
  })

  it("marks every scene that shares a changed character card", async () => {
    seedLedger(await sealedLedger([1, 2, 3]))
    fileSystem.write("/ws/character/jina.card", characterCard("방송부 3학년, 익명 DJ"))

    const result = await new StoryMemoryAuditor(auditRequest()).audit()

    expect(result.audit.staleSceneOrders).toEqual([1, 2, 3])
  })

  it("stays quiet about scenes that come after the one being generated", async () => {
    seedLedger(await sealedLedger([1, 2, 3]))
    fileSystem.write("/ws/scene/03-third.card", sceneCard("03", "third", "고쳐 쓴 3화."))

    const result = await new StoryMemoryAuditor(auditRequest(2)).audit()

    expect(result.audit.staleSceneOrders).toEqual([])
    expect(result.staleWarning).toBeUndefined()
  })

  it("keeps the ledger unchanged when there is nothing new to mark", async () => {
    seedLedger(await sealedLedger([1, 2, 3]))
    const original: string = await ledgerText()

    const result = await new StoryMemoryAuditor(auditRequest()).audit()
    await new StoryMemoryAuditor(auditRequest()).markStale(result)

    expect(await ledgerText()).toBe(original)
  })

  it("writes the stale marks back into the scene states", async () => {
    seedLedger(await sealedLedger([1, 2, 3]))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "고쳐 쓴 요약."))

    const result = await new StoryMemoryAuditor(auditRequest()).audit()
    await new StoryMemoryAuditor(auditRequest()).markStale(result)

    const marked: string = await ledgerText()
    expect(marked).toContain("- [2!] 2화 사실")
    expect(marked).toContain("- [1] 1화 사실")
    expect(states.get("02-second")?.stale).toBe(true)
  })

  it("marks a scene whose narrator changed", async () => {
    seedLedger(await sealedLedger([1, 2, 3]))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "익명 사연이 도착한다.", ["narrator: hana-first"]))

    const result = await new StoryMemoryAuditor(auditRequest()).audit()

    expect(result.audit.staleSceneOrders).toEqual([2])
  })

  it("carries the state of a scene that moved to another thread into that thread's ledger", async () => {
    seedLedger(await sealedLedger([1, 2, 3]))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "익명 사연이 도착한다.", ["thread: ep2"]))

    const main = await new StoryMemoryAuditor(auditRequest()).audit()
    const moved = await new StoryMemoryAuditor(auditRequest(undefined, "ep2")).audit()

    expect(main.audit.staleSceneOrders).toEqual([])
    expect(moved.audit.staleSceneOrders).toEqual([2])
    expect(await ledgerText()).not.toContain("2화 사실")
  })

  it("keeps a stale fact in the prompt until the marks are written", async () => {
    seedLedger(await sealedLedger([1, 2, 3]))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "고쳐 쓴 요약."))

    expect(formatStoryStateForPrompt(await readLedger(), 3)).toContain("2화 사실")

    const result = await new StoryMemoryAuditor(auditRequest(3)).audit()
    await new StoryMemoryAuditor(auditRequest()).markStale(result)

    const afterMarking = formatStoryStateForPrompt(await readLedger(), 3)
    expect(afterMarking ?? "").not.toContain("2화 사실")
    expect(afterMarking).toContain("1화 사실")
  })

  it("returns an empty audit when no scene has a state", async () => {
    const result = await new StoryMemoryAuditor(auditRequest()).audit()

    expect(result.audit.staleSceneOrders).toEqual([])
    expect(result.audit.unsealedSceneOrders).toEqual([])
    expect(result.needsMarking).toBe(false)
  })
})

describe("ledger updates after generation", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn(), dispose: vi.fn() }
  let recorderStates: StubSceneStates

  function sceneAt(order: number): SceneFile {
    return { stem: `0${order}-scene`, order, orderText: `0${order}`, slug: "scene", frontmatter: {}, body: "" } as SceneFile
  }

  function recorderDependencies(): never {
    return {
      host: {
        fileSystem: new MemoryWorkspace(),
        logger,
        scenes: stubScenes([sceneAt(1), sceneAt(2), sceneAt(3)], undefined, recorderStates),
        cards: stubCards()
      },
      ai: { gateway: { getTaskProvider: () => "provider:storyStateUpdate" } }
    } as never
  }

  function generationInputs(order: number, hash: string): never {
    return {
      paths,
      threadPaths: paths,
      scene: sceneAt(order),
      context: { characters: [] },
      inputHash: hash
    } as never
  }

  function aiService(items: unknown[]): never {
    return { updateStoryState: vi.fn(async () => items) } as never
  }

  function seedFact(order: number, value: string): void {
    recorderStates.set(`0${order}-scene`, { statements: [{ facet: "event", value }] })
  }

  const hashA = `sha256:${"a".repeat(64)}`
  const hashB = `sha256:${"b".repeat(64)}`

  beforeEach(() => {
    recorderStates = new Map()
  })

  it("records the scene input hash so the next audit has something to compare", async () => {
    await new StoryStateRecorder(recorderDependencies()).updateAfterGeneration(
      generationInputs(1, hashA),
      aiService([{ section: "facts", text: "1화 사실" }]),
      "본문"
    )

    expect(recorderStates.get("01-scene")).toEqual({
      inputHash: hashA,
      statements: [{ facet: "event", value: "1화 사실" }]
    })
  })

  it("warns with the witness names no card answers to", async () => {
    logger.warn.mockClear()

    await new StoryStateRecorder(recorderDependencies()).updateAfterGeneration(
      generationInputs(1, hashA),
      aiService([{ section: "facts", text: "본 일", witnesses: ["낯선 이"] }]),
      "본문"
    )

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain("낯선 이")
  })

  it("records the hash even when the model returns no items", async () => {
    seedFact(1, "지켜야 할 사실")

    await new StoryStateRecorder(recorderDependencies()).updateAfterGeneration(
      generationInputs(1, hashA),
      aiService([]),
      "본문"
    )

    expect(recorderStates.get("01-scene")).toEqual({
      inputHash: hashA,
      statements: [{ facet: "event", value: "지켜야 할 사실" }]
    })
  })

  it("maps tagged witness names to card ids and falls back to the whole cast", () => {
    const characters = [
      { id: "hana", name: "하나", aliases: ["하나 씨"] },
      { id: "jun", name: "준" }
    ]
    const mapping = toStoryStateEntries(
      [
        { section: "facts", text: "하나만 아는 일", witnesses: ["하나 씨"] },
        { section: "facts", text: "모두 아는 일" },
        { section: "revealed", text: "아는 이름이 없음", witnesses: ["누구"] }
      ],
      characters
    )

    expect(mapping.entries.map((entry) => entry.witnesses)).toEqual([["hana"], ["hana", "jun"], ["hana", "jun"]])
    expect(mapping.unknownWitnesses).toEqual(["누구"])
  })

  it("keeps the whole cast when only some of the tagged names match a card", () => {
    const mapping = toStoryStateEntries(
      [{ section: "facts", text: "둘이 본 일", witnesses: ["김하나", "준"] }],
      [
        { id: "hana", name: "김하나" },
        { id: "jun", name: "이준" }
      ]
    )

    expect(mapping.entries[0]?.witnesses).toEqual(["hana", "jun"])
    expect(mapping.unknownWitnesses).toEqual(["준"])
  })

  it("matches one word of a spaced name when only one card carries it", () => {
    const characters = [
      { id: "kaelen", name: "카일런 베인" },
      { id: "mira", name: "미라 베인" },
      { id: "sol", name: "솔" }
    ]

    const matched = toStoryStateEntries(
      [{ section: "facts", text: "둘이 본 일", witnesses: ["카일런", "솔"] }],
      characters
    )
    expect(matched.entries[0]?.witnesses).toEqual(["kaelen", "sol"])
    expect(matched.unknownWitnesses).toEqual([])

    const ambiguous = toStoryStateEntries(
      [{ section: "facts", text: "성만 적힌 일", witnesses: ["베인"] }],
      characters
    )
    expect(ambiguous.entries[0]?.witnesses).toEqual(["kaelen", "mira", "sol"])
    expect(ambiguous.unknownWitnesses).toEqual(["베인"])
  })

  it("hands the model the cast names, with aliases, to tag witnesses by", async () => {
    const service = aiService([]) as { updateStoryState: ReturnType<typeof vi.fn> }
    const inputs = {
      ...(generationInputs(1, hashA) as object),
      context: { characters: [{ id: "hana", name: "서한아", aliases: ["한서"] }, { id: "jun", name: "준" }] }
    } as never

    await new StoryStateRecorder(recorderDependencies()).updateAfterGeneration(inputs, service as never, "본문")

    expect(service.updateStoryState.mock.calls[0]?.[0]).toMatchObject({
      characterNames: ["서한아 (별칭: 한서)", "준"]
    })
  })

  it("rewinds the later scenes when an earlier one is regenerated", async () => {
    seedFact(1, "1화 사실")
    seedFact(2, "2화 사실")
    seedFact(3, "3화 사실")

    await new StoryStateRecorder(recorderDependencies()).updateAfterGeneration(
      generationInputs(1, hashB),
      aiService([{ section: "facts", text: "다시 만든 1화 사실" }]),
      "본문"
    )

    expect(recorderStates.get("02-scene")?.stale).toBe(true)
    expect(recorderStates.get("03-scene")?.stale).toBe(true)
    expect(recorderStates.get("01-scene")?.statements.map((statement) => statement.value)).toContain(
      "다시 만든 1화 사실"
    )
  })
})

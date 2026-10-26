import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import {
  getStoryboardProjectPaths,
  resolveThreadPaths,
  formatStoryStateForPrompt,
  parseStoryState,
  readStoryState,
} from "@storyboard/story-model"
import type { FileSystemDirectoryEntry, IFileSystem } from "@storyboard/story-engine"
import {
  auditStoryMemory,
  markStoryStateStaleEntries,
  sealStoryMemory
} from "../../../../../../packages/story-engine/src/application/drafts/storyStateAudit"
import { toStoryStateEntries, updateStoryStateAfterGeneration } from "../../../../../../packages/story-engine/src/application/drafts/updateStoryState"

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

function sceneCard(order: string, slug: string, summary: string): string {
  return [
    "type: scene",
    `id: ${order}-${slug}`,
    "characters:",
    "  - jina",
    `summary: ${summary}`,
    ""
  ].join("\n")
}

function characterCard(description: string): string {
  return ["type: character", "id: jina", "name: 진아", "role: main", "description:", `  - ${description}`, ""].join(
    "\n"
  )
}

function ledger(entries: readonly { order: number; hash: string }[]): string {
  return [
    "# 이야기 상태",
    `<!-- through-scene: ${Math.max(...entries.map((entry) => entry.order))} -->`,
    ...entries.map((entry) => `<!-- scene-input: ${entry.order} ${entry.hash} -->`),
    "## 확정 사실",
    ...entries.map((entry) => `- [${entry.order}] ${entry.order}화 사실`),
    ""
  ].join("\n")
}

function auditRequest(fileSystem: IFileSystem, beforeSceneOrder?: number): never {
  return {
    fileSystem,
    paths,
    format: "novel",
    sceneBreakJoiner: undefined,
    ...(beforeSceneOrder === undefined ? {} : { beforeSceneOrder })
  } as never
}

describe("auditStoryMemory", () => {
  let fileSystem: MemoryWorkspace

  beforeEach(() => {
    fileSystem = new MemoryWorkspace()
    fileSystem.write("/ws/character/jina.card", characterCard("방송부 2학년"))
    fileSystem.write("/ws/scene/01-first.card", sceneCard("01", "first", "첫 방송을 마친다."))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "익명 사연이 도착한다."))
    fileSystem.write("/ws/scene/03-third.card", sceneCard("03", "third", "복도에서 원고를 줍는다."))
  })

  it("reports an unsealed ledger instead of calling it stale", async () => {
    fileSystem.write(
      paths.storyState.path,
      "# 이야기 상태\n<!-- through-scene: 2 -->\n## 확정 사실\n- [1] 1화 사실\n- [2] 2화 사실\n"
    )

    const result = await auditStoryMemory(auditRequest(fileSystem))

    expect(result.audit.staleSceneOrders).toEqual([])
    expect(result.audit.unsealedSceneOrders).toEqual([1, 2])
    expect(result.staleWarning).toBeUndefined()
    expect(result.needsMarking).toBe(false)
  })

  it("finds nothing stale while every scene still hashes the same", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))

    const result = await auditStoryMemory(auditRequest(fileSystem))

    expect(result.audit.staleSceneOrders).toEqual([])
    expect(result.needsMarking).toBe(false)
  })

  it("marks the scenes whose cards changed after the ledger was written", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "고쳐 쓴 요약."))

    const result = await auditStoryMemory(auditRequest(fileSystem, 3))

    expect(result.audit.staleSceneOrders).toEqual([2])
    expect(result.staleWarning).toContain("씬 2")
    expect(result.needsMarking).toBe(true)
  })

  it("marks every scene that shares a changed character card", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))
    fileSystem.write("/ws/character/jina.card", characterCard("방송부 3학년, 익명 DJ"))

    const result = await auditStoryMemory(auditRequest(fileSystem))

    expect(result.audit.staleSceneOrders).toEqual([1, 2, 3])
  })

  it("marks a scene whose card is gone", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))
    fileSystem.remove("/ws/scene/02-second.card")

    const result = await auditStoryMemory(auditRequest(fileSystem))

    expect(result.audit.staleSceneOrders).toEqual([2])
  })

  it("stays quiet about scenes that come after the one being generated", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))
    fileSystem.write("/ws/scene/03-third.card", sceneCard("03", "third", "고쳐 쓴 3화."))

    const result = await auditStoryMemory(auditRequest(fileSystem, 2))

    expect(result.audit.staleSceneOrders).toEqual([])
    expect(result.staleWarning).toBeUndefined()
  })

  it("keeps the ledger unchanged when there is nothing new to mark", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    const original = ledger(hashes)
    fileSystem.write(paths.storyState.path, original)

    const result = await auditStoryMemory(auditRequest(fileSystem))
    await markStoryStateStaleEntries(paths, fileSystem, result)

    expect(fileSystem.read(paths.storyState.path)).toBe(original)
  })

  it("writes the stale marks back into the ledger", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "고쳐 쓴 요약."))

    const result = await auditStoryMemory(auditRequest(fileSystem))
    await markStoryStateStaleEntries(paths, fileSystem, result)

    const marked = fileSystem.read(paths.storyState.path) ?? ""
    expect(marked).toContain("- [2!] 2화 사실")
    expect(marked).toContain("- [1] 1화 사실")
  })

  it("marks a scene whose narrator changed", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))
    fileSystem.write(
      "/ws/scene/02-second.card",
      `${sceneCard("02", "second", "익명 사연이 도착한다.").trimEnd()}\nnarrator: hana-first\n`
    )

    const result = await auditStoryMemory(auditRequest(fileSystem))

    expect(result.audit.staleSceneOrders).toEqual([2])
  })

  it("marks a scene that moved to another thread", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))
    fileSystem.write(
      "/ws/scene/02-second.card",
      `${sceneCard("02", "second", "익명 사연이 도착한다.").trimEnd()}\nthread: ep2\n`
    )

    const result = await auditStoryMemory(auditRequest(fileSystem))

    expect(result.audit.staleSceneOrders).toEqual([2])
  })

  it("marks a scene whose focal character changed", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))
    fileSystem.write(
      "/ws/scene/02-second.card",
      `${sceneCard("02", "second", "익명 사연이 도착한다.").trimEnd()}\npovCharacter: jina\n`
    )

    const result = await auditStoryMemory(auditRequest(fileSystem))

    expect(result.audit.staleSceneOrders).toEqual([2])
  })

  it("audits and marks only the thread ledger it was given", async () => {
    const threadPaths = resolveThreadPaths(paths, "ep2")
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    const mainLedger = ledger(hashes)
    fileSystem.write(paths.storyState.path, mainLedger)
    fileSystem.write(threadPaths.storyState.path, mainLedger)
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "고쳐 쓴 요약."))

    const result = await auditStoryMemory({
      ...(auditRequest(fileSystem) as object),
      paths: threadPaths
    } as never)
    await markStoryStateStaleEntries(threadPaths, fileSystem, result)

    expect(fileSystem.read(threadPaths.storyState.path)).toContain("- [2!] 2화 사실")
    expect(fileSystem.read(paths.storyState.path)).toBe(mainLedger)
  })

  it("keeps a stale fact in the prompt until the marks are written", async () => {
    const hashes = await sealedLedger(fileSystem, [1, 2, 3])
    fileSystem.write(paths.storyState.path, ledger(hashes))
    fileSystem.write("/ws/scene/02-second.card", sceneCard("02", "second", "고쳐 쓴 요약."))

    const beforeMarking = formatStoryStateForPrompt(
      await readStoryState(paths.storyState, fileSystem),
      3
    )
    expect(beforeMarking).toContain("2화 사실")

    const result = await auditStoryMemory(auditRequest(fileSystem, 3))
    await markStoryStateStaleEntries(paths, fileSystem, result)

    const afterMarking = formatStoryStateForPrompt(
      await readStoryState(paths.storyState, fileSystem),
      3
    )
    expect(afterMarking ?? "").not.toContain("2화 사실")
    expect(afterMarking).toContain("1화 사실")
  })

  it("returns an empty audit when the ledger does not exist", async () => {
    const result = await auditStoryMemory(auditRequest(fileSystem))

    expect(result.audit.staleSceneOrders).toEqual([])
    expect(result.audit.unsealedSceneOrders).toEqual([])
    expect(result.needsMarking).toBe(false)
  })
})

describe("ledger updates after generation", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn(), dispose: vi.fn() }

  function generationOptions(fileSystem: MemoryWorkspace): never {
    return {
      host: { fileSystem, logger },
      ai: { gateway: { getTaskProvider: () => "provider:storyStateUpdate" } }
    } as never
  }

  function generationInputs(order: number, hash: string): never {
    return {
      paths,
      threadPaths: paths,
      scene: { stem: `0${order}-scene`, order },
      context: { characters: [] },
      inputHash: hash
    } as never
  }

  function aiService(items: unknown[]): never {
    return { updateStoryState: vi.fn(async () => items) } as never
  }

  const hashA = `sha256:${"a".repeat(64)}`
  const hashB = `sha256:${"b".repeat(64)}`

  it("records the scene input hash so the next audit has something to compare", async () => {
    const fileSystem = new MemoryWorkspace()

    await updateStoryStateAfterGeneration(
      generationInputs(1, hashA),
      generationOptions(fileSystem),
      aiService([{ section: "facts", text: "1화 사실" }]),
      "본문"
    )

    expect(fileSystem.read(paths.storyState.path)).toContain(`<!-- scene-input: 1 ${hashA} -->`)
  })

  it("warns with the witness names no card answers to", async () => {
    const fileSystem = new MemoryWorkspace()
    logger.warn.mockClear()

    await updateStoryStateAfterGeneration(
      generationInputs(1, hashA),
      generationOptions(fileSystem),
      aiService([{ section: "facts", text: "본 일", witnesses: ["낯선 이"] }]),
      "본문"
    )

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain("낯선 이")
  })

  it("records the hash even when the model returns no items", async () => {
    const fileSystem = new MemoryWorkspace()
    fileSystem.write(
      paths.storyState.path,
      "# 이야기 상태\n<!-- through-scene: 1 -->\n## 확정 사실\n- [1] 지켜야 할 사실\n"
    )

    await updateStoryStateAfterGeneration(
      generationInputs(1, hashA),
      generationOptions(fileSystem),
      aiService([]),
      "본문"
    )

    const ledgerText = fileSystem.read(paths.storyState.path) ?? ""
    expect(ledgerText).toContain(`<!-- scene-input: 1 ${hashA} -->`)
    expect(ledgerText).toContain("- [1] 지켜야 할 사실")
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
    const fileSystem = new MemoryWorkspace()
    const service = aiService([]) as { updateStoryState: ReturnType<typeof vi.fn> }
    const inputs = {
      ...(generationInputs(1, hashA) as object),
      context: { characters: [{ id: "hana", name: "서한아", aliases: ["한서"] }, { id: "jun", name: "준" }] }
    } as never

    await updateStoryStateAfterGeneration(inputs, generationOptions(fileSystem), service as never, "본문")

    expect(service.updateStoryState.mock.calls[0]?.[0]).toMatchObject({
      characterNames: ["서한아 (별칭: 한서)", "준"]
    })
  })

  it("rewinds the later scenes when an earlier one is regenerated", async () => {
    const fileSystem = new MemoryWorkspace()
    fileSystem.write(
      paths.storyState.path,
      [
        "# 이야기 상태",
        "<!-- through-scene: 3 -->",
        "## 확정 사실",
        "- [1] 1화 사실",
        "- [2] 2화 사실",
        "- [3] 3화 사실",
        ""
      ].join("\n")
    )

    await updateStoryStateAfterGeneration(
      generationInputs(1, hashB),
      generationOptions(fileSystem),
      aiService([{ section: "facts", text: "다시 만든 1화 사실" }]),
      "본문"
    )

    const ledgerText = fileSystem.read(paths.storyState.path) ?? ""
    expect(ledgerText).toContain("- [2!] 2화 사실")
    expect(ledgerText).toContain("- [3!] 3화 사실")
    expect(ledgerText).toContain("- [1] 다시 만든 1화 사실")
  })
})

async function sealedLedger(
  fileSystem: MemoryWorkspace,
  orders: readonly number[]
): Promise<{ order: number; hash: string }[]> {
  fileSystem.write(
    paths.storyState.path,
    [
      "# 이야기 상태",
      `<!-- through-scene: ${Math.max(...orders)} -->`,
      "## 확정 사실",
      ...orders.map((order) => `- [${order}] ${order}화 사실`),
      ""
    ].join("\n")
  )

  await sealStoryMemory(auditRequest(fileSystem))

  const sealed = parseStoryState(fileSystem.read(paths.storyState.path) ?? "")
  fileSystem.remove(paths.storyState.path)

  return orders.map((order) => {
    const hash = sealed.sceneInputHashes.get(order)

    if (hash === undefined) {
      throw new Error(`씬 ${order}의 봉인 해시를 얻지 못했습니다.`)
    }

    return { order, hash }
  })
}

import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { getStoryboardProjectPaths } from "@storyboard/story-engine"
import { parseStoryState } from "@storyboard/story-format"
import type { FileSystemDirectoryEntry, IFileSystem } from "@storyboard/story-engine"
import {
  auditStoryMemory,
  markStoryStateStaleEntries,
  sealStoryMemory
} from "../../../../../../packages/story-engine/src/application/drafts/storyStateAudit"
import { updateStoryStateAfterGeneration } from "../../../../../../packages/story-engine/src/application/drafts/updateStoryState"

// 원장 감사는 워크스페이스를 통째로 읽어 해시를 다시 계산한다. 카드·씬을 흉내 내면 그 계산이
// 실제로 무엇에 반응하는지 검증할 수 없으므로, 진짜 파일 내용을 담은 메모리 파일 시스템을 쓴다.
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

  // 봉인이 없는 0.8 이전 원장. 대조할 근거가 없으므로 낡음으로 몰지 않는다.
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

  // 21~32를 고쳐 놓고 25만 다시 만드는 경우. 25보다 앞의 낡은 항목이 프롬프트로 새면 새 설정과
  // 옛 사실이 충돌한다.
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

  // 뒤 씬의 낡은 항목은 어차피 이번 프롬프트에 실리지 않는다. 32씬을 순서대로 다시 만드는 동안
  // 매 씬 경고가 뜨면 진짜 경고가 묻힌다.
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
      fileSystem,
      logger,
      aiGateway: { getTaskProvider: () => "provider:storyStateUpdate" }
    } as never
  }

  function generationInputs(order: number, hash: string): never {
    return {
      paths,
      // 줄기를 선언하지 않은 작품에서는 threadPaths가 paths와 같다.
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

  // 원장 갱신에서 항목을 못 받아도 이번 판본이 기준이 되어야 다음 감사가 옳게 대조한다.
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

// 봉인 해시는 감사가 계산하는 값과 같아야 한다. 손으로 적는 대신 sealStoryMemory를 한 번 돌려
// 원장에 기록된 값을 그대로 읽어 온다.
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

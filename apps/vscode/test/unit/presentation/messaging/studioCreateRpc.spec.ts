import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { StudioCreateRpc } from "@/presentation/messaging/studioCreateRpcHandlers"
import { StudioLauncher } from "@/presentation/providers/studioLauncher"
import { commands } from "../../../stubs/vscode"

const workspaceRoot = vscode.Uri.file("/ws")
const appliedEdit = { ok: true, kind: "applied", sessionId: "s", summary: "설명으로 채움", message: "" }

interface Harness {
  readonly rpc: StudioCreateRpc
  readonly create: ReturnType<typeof vi.fn>
  readonly extractStudioCardSeed: ReturnType<typeof vi.fn>
  readonly mounted: ReturnType<typeof vi.fn>
}

function harness(seed: unknown, launcher = { takePendingKind: vi.fn(() => undefined) }): Harness {
  const create = vi.fn(async (request: { kind: string; slug?: string }) => ({
    ok: true,
    kind: "created",
    key: request.slug ?? `new-${request.kind}`,
    uri: workspaceRoot,
    edit: appliedEdit
  }))
  const extractStudioCardSeed = vi.fn(async () => seed)
  const mounted = vi.fn()
  const rpc = new StudioCreateRpc({
    aiGateway: {
      createService: () => ({ extractStudioCardSeed }),
      getTaskProvider: () => "mock"
    } as never,
    studio: { create } as never,
    launcher,
    logger: { warn: vi.fn() } as never,
    getProjectRoot: async (): Promise<vscode.Uri> => workspaceRoot,
    onWebviewMounted: mounted
  })
  return { rpc, create, extractStudioCardSeed, mounted }
}

let opened: unknown[] = []

beforeEach(() => {
  opened = []
  vi.spyOn(commands, "executeCommand").mockImplementation(async (...args: unknown[]) => {
    opened.push(args)
    return undefined
  })
})

describe("studio create rpc", () => {
  it("leaves the name of an asked kind to the engine and opens the viewer it made", async () => {
    const { rpc, create, extractStudioCardSeed } = harness({ kind: "character", name: "엘리아", id: "elia" })

    const result = await rpc.handlers()["studio.create"]({ kind: "character", description: "엘리아. 열일곱 전학생." })

    const request = create.mock.calls[0]?.[0] as Record<string, unknown>
    expect(extractStudioCardSeed).not.toHaveBeenCalled()
    expect(request).toMatchObject({
      workspaceRoot,
      kind: "character",
      description: "엘리아. 열일곱 전학생.",
      shouldPropose: false
    })
    expect(request.name).toBeUndefined()
    expect(request.slug).toBeUndefined()
    expect(result).toEqual({ ok: true, message: "인물 new-character 를 만들었어요. 설명으로 채움" })
    expect(opened[0]).toEqual([
      "vscode.openWith",
      vscode.Uri.file("/ws/character/new-character.card/card.yaml"),
      "storyboard.card"
    ])
  })

  it("reads the kind and the name from the description when no kind was asked", async () => {
    const { rpc, create } = harness({ kind: "background", name: "야시장", id: "night-market" })

    await rpc.handlers()["studio.create"]({ description: "자정에 닫는 항구 야시장" })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "background",
        name: "야시장",
        slug: "night-market",
        whenSlugIsTaken: "number-it"
      })
    )
  })

  it("does not ask for a card name when making a scene", async () => {
    const { rpc, create, extractStudioCardSeed } = harness({ kind: "character", name: "x", id: "x" })

    await rpc.handlers()["studio.create"]({ kind: "scene", description: "옥상에서 처음 마주친다" })

    expect(extractStudioCardSeed).not.toHaveBeenCalled()
    expect(create.mock.calls[0]?.[0]).toMatchObject({ kind: "scene" })
  })

  it("refuses a description whose kind it cannot read when no kind was asked", async () => {
    const { rpc, create } = harness(undefined)

    const result = await rpc.handlers()["studio.create"]({ description: "무언가" })

    expect(result.ok).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it("hands the pending + request to the studio once it is mounted", async () => {
    const launcher = new StudioLauncher()
    await launcher.requestCreate("scene")
    const { rpc, mounted } = harness(undefined, launcher)

    expect(await rpc.handlers()["studio.create.pending"]({})).toEqual({ kind: "scene" })
    expect(await rpc.handlers()["studio.create.pending"]({})).toEqual({})
    expect(mounted).toHaveBeenCalledTimes(2)
    expect(opened[0]).toEqual(["storyboard.studioView.focus"])
  })
})

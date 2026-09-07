import { stubFileSystem } from "../../../stubs/fileSystem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

const buildSceneContextMock = vi.fn()

vi.mock("@storyboard/story-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyboard/story-format")>()),
  buildSceneContext: (...args: unknown[]): unknown => buildSceneContextMock(...args)
}))
import { GenerateSceneBeatsUseCase } from "@storyboard/story-engine"
import { planSceneBeatCount, SceneParseError } from "@storyboard/story-format"

const sceneUri = vscode.Uri.file("/workspace/scene/01-intro.card")
const workspaceRoot = vscode.Uri.file("/workspace")

function scene(overrides: Record<string, unknown> = {}): unknown {
  return {
    stem: "01-intro",
    order: 1,
    orderText: "01",
    slug: "intro",
    frontmatter: { targetWordCount: 4000 },
    card: { type: "scene", id: "01-intro", purpose: "첫 만남", summary: "01-intro.summary.md" },
    summaryText: "준서가 하나를 만난다.\n",
    body: "[목적]\n첫 만남\n\n준서가 하나를 만난다.\n",
    ...overrides
  }
}

function createUseCase(sceneFile: unknown): {
  proposeSceneBeats: ReturnType<typeof vi.fn>
  writeBeats: ReturnType<typeof vi.fn>
  useCase: GenerateSceneBeatsUseCase
} {
  const proposeSceneBeats = vi.fn(async () => ["첫 비트", "둘째 비트", "셋째 비트"])
  const writeBeats = vi.fn(async () => undefined)
  const read = vi.fn(async () => {
    if (sceneFile instanceof Error) {
      throw sceneFile
    }
    return sceneFile
  })

  return {
    proposeSceneBeats,
    writeBeats,
    useCase: new GenerateSceneBeatsUseCase({
      aiGateway: {
        createService: () => ({ proposeSceneBeats }),
        getTaskProvider: (task: string) => `provider:${task}`
      } as never,
      configBridge: {
        isAutoBeatsEnabled: () => true,
        getCharsPerBeat: () => 1500,
        getMinBeats: () => 2
      } as never,
      fileSystem: stubFileSystem,
      logger: { error: vi.fn(), warn: vi.fn() } as never,
      sceneRepository: { read, writeBeats } as never
    })
  }
}

describe("planSceneBeatCount", () => {
  it("divides the target length by the chars-per-beat budget and keeps the floor", () => {
    expect(planSceneBeatCount(3000, 1500, 5)).toBe(5)
    expect(planSceneBeatCount(15000, 1500, 5)).toBe(10)
    expect(planSceneBeatCount(undefined, 1500, 5)).toBe(5)
    expect(planSceneBeatCount(0, 1500, 5)).toBe(5)
  })
})

describe("GenerateSceneBeatsUseCase", () => {
  beforeEach(() => {
    buildSceneContextMock.mockReset().mockResolvedValue({
      characters: [{ name: "준서" }, { name: "하나" }]
    })
  })

  it("proposes beats sized to the target length and writes them to the card", async () => {
    const { useCase, proposeSceneBeats, writeBeats } = createUseCase(scene())

    const result = await useCase.execute({ workspaceRoot, sceneUri, fileName: "01-intro.card" })

    expect(result).toEqual({ ok: true, kind: "proposed", beats: ["첫 비트", "둘째 비트", "셋째 비트"], written: true })
    expect(proposeSceneBeats).toHaveBeenCalledWith(
      {
        sceneBody: "[목적]\n첫 만남\n",
        summary: "준서가 하나를 만난다.\n",
        grounding: undefined,
        characterNames: ["준서", "하나"],
        // ceil(4000 / 1500) = 3 > minBeats 2
        beatCount: 3
      },
      { providerId: "provider:sceneBeats", attribution: { primary: { kind: "scene", id: "01-intro" } } }
    )
    expect(writeBeats).toHaveBeenCalledWith(sceneUri, ["첫 비트", "둘째 비트", "셋째 비트"])
  })

  it("keeps existing beats unless forced", async () => {
    const withBeats = scene({ card: { type: "scene", id: "01-intro", beats: ["기존 비트"] } })
    const { useCase, proposeSceneBeats, writeBeats } = createUseCase(withBeats)

    const kept = await useCase.execute({ workspaceRoot, sceneUri, fileName: "01-intro.card" })
    expect(kept).toEqual({ ok: true, kind: "kept", beats: ["기존 비트"] })
    expect(proposeSceneBeats).not.toHaveBeenCalled()

    const forced = await useCase.execute({ workspaceRoot, sceneUri, fileName: "01-intro.card", force: true })
    expect(forced.kind).toBe("proposed")
    expect(writeBeats).toHaveBeenCalledTimes(1)
  })

  it("returns the proposal without writing on a dry run", async () => {
    const { useCase, writeBeats } = createUseCase(scene())

    const result = await useCase.execute({ workspaceRoot, sceneUri, fileName: "01-intro.card", dryRun: true })

    expect(result).toMatchObject({ ok: true, kind: "proposed", written: false })
    expect(writeBeats).not.toHaveBeenCalled()
  })

  it("fails on an empty proposal and on an unreadable scene", async () => {
    const empty = createUseCase(scene())
    empty.proposeSceneBeats.mockResolvedValueOnce([])
    expect(await empty.useCase.execute({ workspaceRoot, sceneUri, fileName: "01-intro.card" })).toMatchObject({
      ok: false,
      kind: "failed"
    })
    expect(empty.writeBeats).not.toHaveBeenCalled()

    const unreadable = createUseCase(new SceneParseError("missing-scene-summary-file", "summary 파일이 없습니다."))
    expect(await unreadable.useCase.execute({ workspaceRoot, sceneUri, fileName: "01-intro.card" })).toMatchObject({
      ok: false,
      kind: "failed",
      message: expect.stringContaining("summary 파일이 없습니다.")
    })
  })
})

import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { parseBundleFolderRename, validateCardRenameId } from "@/infrastructure/vscode/bundleFolderRename"
import { CardRenameParticipant } from "@/presentation/providers/CardRenameParticipant"
import type { IStoryboardLogger } from "@storyboard/story-engine"
import { fireDidRenameFiles, window, workspace, type WorkspaceFolder } from "../../../stubs/vscode"

const workspaceRoot = vscode.Uri.file("/ws/project")
const workspaceFolder = { uri: workspaceRoot, name: "project", index: 0 }

beforeEach(() => {
  workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
    uri.fsPath.startsWith(workspaceRoot.fsPath) ? workspaceFolder : undefined
})

describe("parseBundleFolderRename", () => {
  it("reads a character bundle folder rename as a slug change", () => {
    const oldUri = vscode.Uri.file("/ws/project/character/hero.card")
    const newUri = vscode.Uri.file("/ws/project/character/protagonist.card")

    expect(parseBundleFolderRename(oldUri, newUri)).toEqual({
      kind: "character",
      workspaceRoot,
      oldUri,
      newUri,
      fromKey: "hero",
      toKey: "protagonist"
    })
  })

  it("reads a scene bundle folder rename with its number", () => {
    const oldUri = vscode.Uri.file("/ws/project/scene/003-rooftop.card")
    const newUri = vscode.Uri.file("/ws/project/scene/003-roof.card")

    expect(parseBundleFolderRename(oldUri, newUri)).toMatchObject({
      kind: "scene",
      fromKey: "003-rooftop",
      toKey: "003-roof"
    })
  })

  it("ignores files inside a bundle, moves across folders and names that are not bundles", () => {
    expect(
      parseBundleFolderRename(
        vscode.Uri.file("/ws/project/character/hero.card/card.yaml"),
        vscode.Uri.file("/ws/project/character/hero.card/old.yaml")
      )
    ).toBeUndefined()
    expect(
      parseBundleFolderRename(
        vscode.Uri.file("/ws/project/character/hero.card"),
        vscode.Uri.file("/ws/project/background/hero.card")
      )
    ).toBeUndefined()
    expect(
      parseBundleFolderRename(
        vscode.Uri.file("/ws/project/character/hero.card"),
        vscode.Uri.file("/ws/project/character/Hero Card")
      )
    ).toBeUndefined()
  })

  it("ignores renames outside the workspace folder", () => {
    workspace.getWorkspaceFolder = (): undefined => undefined

    expect(
      parseBundleFolderRename(
        vscode.Uri.file("/ws/project/character/hero.card"),
        vscode.Uri.file("/ws/project/character/protagonist.card")
      )
    ).toBeUndefined()
  })

  it("validates rename ids with cardIdPattern", () => {
    expect(validateCardRenameId("hero-1")).toBeUndefined()
    expect(validateCardRenameId("Bad Id")).toBe(
      "ID는 영문 소문자, 숫자, 하이픈만 사용할 수 있고 숫자/문자로 시작해야 합니다."
    )
  })
})

interface ParticipantFixture {
  readonly participant: CardRenameParticipant
  readonly cards: { readonly rename: ReturnType<typeof vi.fn> }
  readonly drafts: { readonly renameScene: ReturnType<typeof vi.fn> }
}

describe("CardRenameParticipant", () => {
  function createParticipant(renameResult: { ok: boolean; message?: string }): ParticipantFixture {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const cards = { rename: vi.fn(async () => renameResult) }
    const drafts = { renameScene: vi.fn(async () => renameResult) }
    const participant = new CardRenameParticipant({
      cards: cards as never,
      drafts: drafts as never,
      logger: logger as unknown as IStoryboardLogger
    })
    return { participant, cards, drafts }
  }

  it("moves the folder back and renames the card through the engine", async () => {
    const { participant, cards } = createParticipant({ ok: true })
    const rename = vi.fn(async () => undefined)
    workspace.fs.rename = rename
    const disposable = participant.register()
    const oldUri = vscode.Uri.file("/ws/project/character/hero.card")
    const newUri = vscode.Uri.file("/ws/project/character/protagonist.card")

    fireDidRenameFiles({ files: [{ oldUri, newUri }] })
    await vi.waitFor(() => expect(cards.rename).toHaveBeenCalled())

    expect(rename).toHaveBeenCalledWith(newUri, oldUri, { overwrite: false })
    expect(cards.rename).toHaveBeenCalledWith({
      workspaceRoot,
      category: "character",
      fromId: "hero",
      toId: "protagonist"
    })
    disposable.dispose()
  })

  it("renames a scene through the scene verb and warns when the engine refuses", async () => {
    const { participant, drafts } = createParticipant({ ok: false, message: "번호는 바꿀 수 없습니다." })
    workspace.fs.rename = vi.fn(async () => undefined)
    const warn = vi.spyOn(window, "showWarningMessage")
    const disposable = participant.register()

    fireDidRenameFiles({
      files: [
        {
          oldUri: vscode.Uri.file("/ws/project/scene/003-rooftop.card"),
          newUri: vscode.Uri.file("/ws/project/scene/005-rooftop.card")
        }
      ]
    })
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())

    expect(drafts.renameScene).toHaveBeenCalledWith({
      workspaceRoot,
      fromStem: "003-rooftop",
      toStem: "005-rooftop"
    })
    expect(warn.mock.calls[0]?.[0]).toContain("번호는 바꿀 수 없습니다.")
    disposable.dispose()
  })
})

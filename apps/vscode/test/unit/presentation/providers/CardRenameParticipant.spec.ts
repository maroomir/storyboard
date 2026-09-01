import * as vscode from "vscode"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildCardRenameWorkspaceEdit,
  parseCardRenameCandidate,
  validateCardRenameId
} from "@/infrastructure/vscode/cardRenameEdit"
import { registerCardRenameParticipant } from "@/presentation/providers/CardRenameParticipant"
import type { IStoryboardLogger } from '@storyboard/story-engine';
import {
  fireWillRenameFiles,
  FileType,
  workspace,
  type WorkspaceEdit as StubWorkspaceEdit,
  type WorkspaceFolder
} from "../../../stubs/vscode"

describe("CardRenameParticipant helpers", () => {
  const workspaceRoot = vscode.Uri.file("/ws/project")
  const workspaceFolder = { uri: workspaceRoot, name: "project", index: 0 }

  beforeEach(() => {
    workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
      uri.fsPath.startsWith(workspaceRoot.fsPath) ? workspaceFolder : undefined
  })

  it("accepts character card renames within the character directory", () => {
    const oldUri = vscode.Uri.file("/ws/project/character/hero.card")
    const newUri = vscode.Uri.file("/ws/project/character/protagonist.card")

    expect(parseCardRenameCandidate(oldUri, newUri)).toEqual({
      kind: "character",
      workspaceRoot,
      oldId: "hero",
      newId: "protagonist"
    })
  })

  it("accepts background card renames within the background directory", () => {
    const oldUri = vscode.Uri.file("/ws/project/background/town.card")
    const newUri = vscode.Uri.file("/ws/project/background/city.card")

    expect(parseCardRenameCandidate(oldUri, newUri)).toEqual({
      kind: "background",
      workspaceRoot,
      oldId: "town",
      newId: "city"
    })
  })

  it("ignores sample cards, non-card files, and cross-directory renames", () => {
    const sampleOld = vscode.Uri.file("/ws/project/character/.sample.card")
    const sampleNew = vscode.Uri.file("/ws/project/character/new.card")
    const crossDirOld = vscode.Uri.file("/ws/project/character/hero.card")
    const crossDirNew = vscode.Uri.file("/ws/project/background/hero.card")
    const nonCard = vscode.Uri.file("/ws/project/character/readme.txt")

    expect(parseCardRenameCandidate(sampleOld, sampleNew)).toBeUndefined()
    expect(parseCardRenameCandidate(crossDirOld, crossDirNew)).toBeUndefined()
    expect(parseCardRenameCandidate(nonCard, crossDirNew)).toBeUndefined()
  })

  it("ignores renames outside the workspace folder", () => {
    workspace.getWorkspaceFolder = (): undefined => undefined

    const oldUri = vscode.Uri.file("/ws/project/character/hero.card")
    const newUri = vscode.Uri.file("/ws/project/character/protagonist.card")

    expect(parseCardRenameCandidate(oldUri, newUri)).toBeUndefined()
  })

  it("validates rename ids with cardIdPattern", () => {
    expect(validateCardRenameId("hero-1")).toBeUndefined()
    expect(validateCardRenameId("Bad Id")).toBe(
      "ID는 영문 소문자, 숫자, 하이픈만 사용할 수 있고 숫자/문자로 시작해야 합니다."
    )
  })
})

describe("buildCardRenameWorkspaceEdit", () => {
  const workspaceRoot = vscode.Uri.file("/ws/project")
  const workspaceFolder = { uri: workspaceRoot, name: "project", index: 0 }

  beforeEach(() => {
    workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
      uri.fsPath.startsWith(workspaceRoot.fsPath) ? workspaceFolder : undefined
    workspace.findFiles = async (): Promise<vscode.Uri[]> => []
    workspace.fs.stat = async (): Promise<{ type: FileType }> => {
      throw new Error("not found")
    }
  })

  it("targets oldUri for the renamed card body text edit", async () => {
    const oldUri = vscode.Uri.file("/ws/project/character/item.card")
    const newUri = vscode.Uri.file("/ws/project/character/manjae-jo.card")
    const cardText = "type: character\nid: item\nname: Item\n"

    workspace.fs.readFile = async (uri): Promise<Uint8Array> => {
      if (uri.fsPath === oldUri.fsPath) {
        return new TextEncoder().encode(cardText)
      }
      throw new Error(`unexpected read: ${uri.fsPath}`)
    }

    const edit = await buildCardRenameWorkspaceEdit(oldUri, newUri)

    expect(edit).toBeDefined()
    const replacements = (edit as vscode.WorkspaceEdit & { getReplacements(): readonly { uri: vscode.Uri; text: string }[] }).getReplacements()
    const bodyEdit = replacements.find((replacement) => replacement.text.includes("id: manjae-jo"))

    expect(bodyEdit).toBeDefined()
    expect(bodyEdit?.uri.fsPath).toBe(oldUri.fsPath)
    expect(bodyEdit?.uri.fsPath).not.toBe(newUri.fsPath)
  })
})

describe("registerCardRenameParticipant", () => {
  const workspaceRoot = vscode.Uri.file("/ws/project")
  const workspaceFolder = { uri: workspaceRoot, name: "project", index: 0 }

  beforeEach(() => {
    workspace.getWorkspaceFolder = (uri): WorkspaceFolder | undefined =>
      uri.fsPath.startsWith(workspaceRoot.fsPath) ? workspaceFolder : undefined
    workspace.findFiles = async (): Promise<vscode.Uri[]> => []
    workspace.fs.stat = async (): Promise<{ type: FileType }> => {
      throw new Error("not found")
    }
  })

  it("logs card renames when handling onWillRenameFiles", async () => {
    const oldUri = vscode.Uri.file("/ws/project/character/hero.card")
    const newUri = vscode.Uri.file("/ws/project/character/protagonist.card")
    const cardText = "type: character\nid: hero\nname: Hero\n"
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

    workspace.fs.readFile = async (uri): Promise<Uint8Array> => {
      if (uri.fsPath === oldUri.fsPath) {
        return new TextEncoder().encode(cardText)
      }
      throw new Error(`unexpected read: ${uri.fsPath}`)
    }

    registerCardRenameParticipant({ logger: logger as unknown as IStoryboardLogger })

    let waitUntilPromise: Promise<StubWorkspaceEdit | undefined> | undefined

    fireWillRenameFiles({
      files: [{ oldUri, newUri }],
      waitUntil(thenable) {
        waitUntilPromise = thenable
      }
    })

    await waitUntilPromise

    expect(logger.info).toHaveBeenCalledWith(
      `card rename participant: ${oldUri.fsPath} -> ${newUri.fsPath} (n=1)`
    )
    expect(logger.info).toHaveBeenCalledWith("card rename participant: applied edits for 1 card(s)")
  })
})

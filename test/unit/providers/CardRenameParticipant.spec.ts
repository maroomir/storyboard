import * as vscode from "vscode"
import { beforeEach, describe, expect, it } from "vitest"

import {
  parseCardRenameCandidate,
  validateCardRenameId
} from "@/core/cardRenameEdit"
import { workspace } from "../../stubs/vscode"

describe("CardRenameParticipant helpers", () => {
  const workspaceRoot = vscode.Uri.file("/ws/project")
  const workspaceFolder = { uri: workspaceRoot, name: "project", index: 0 }

  beforeEach(() => {
    workspace.getWorkspaceFolder = (uri: vscode.Uri): typeof workspaceFolder | undefined =>
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

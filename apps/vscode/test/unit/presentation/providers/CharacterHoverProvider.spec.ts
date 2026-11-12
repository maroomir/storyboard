import * as vscode from "vscode"
import { describe, expect, it, vi } from "vitest"

import { workspace, type WorkspaceFolder } from "../../../stubs/vscode"
import { buildCharacterHoverMarkdown, CharacterHoverProvider } from "@/presentation/providers/CharacterHoverProvider"
import type { CharacterCard } from '@storyboard/story-model';

vi.mock("@/infrastructure/vscode/workspace", () => ({
  hasStoryboardProject: vi.fn(async () => true)
}))

describe("CharacterHoverProvider helpers", () => {
  it("renders compact character summary markdown", () => {
    const character: CharacterCard = {
      type: "character",
      id: "elia",
      name: "엘리아",
      profile: "명랑한 주인공",
      description: ["상황을 빠르게 파악한다."],
      traits: ["침착함", "리더십"],
      relations: [{ target: "jihoon", type: "friend" }]
    }

    const markdown = buildCharacterHoverMarkdown({
      character,
      relatedCharacterNames: ["지훈"]
    })

    expect(markdown.value).toContain("### 엘리아")
    expect(markdown.value).toContain("명랑한 주인공")
    expect(markdown.value).toContain("침착함")
    expect(markdown.value).toContain("관계: 지훈")
  })
})

describe("CharacterHoverProvider", () => {
  it("finds the hovered character among the cards the card manager lists", async () => {
    const folder: WorkspaceFolder = { uri: vscode.Uri.file("/ws"), name: "ws", index: 0 } as WorkspaceFolder
    vi.spyOn(workspace, "getWorkspaceFolder").mockReturnValue(folder)
    const listCharacters = vi.fn(async (): Promise<readonly CharacterCard[]> => [
      { type: "character", id: "elia", name: "엘리아", traits: ["침착함"] }
    ])
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 3))
    const document = {
      uri: vscode.Uri.file("/ws/draft/001-gate.md"),
      getWordRangeAtPosition: () => range,
      getText: () => "엘리아"
    } as unknown as vscode.TextDocument

    const hover = await new CharacterHoverProvider({ cards: { listCharacters } }).provideHover(
      document,
      new vscode.Position(0, 1)
    )

    expect(listCharacters).toHaveBeenCalledWith(folder.uri)
    expect(JSON.stringify(hover?.contents)).toContain("엘리아")
  })
})

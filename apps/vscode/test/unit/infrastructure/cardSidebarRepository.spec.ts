import * as vscode from "vscode"
import { describe, expect, it } from "vitest"

import { CardSidebarRepository, type WorkspaceCards } from "@storyboard/story-engine"

import { stubCards } from "../../stubs/cards"

describe("CardSidebarRepository", () => {
  it("lists valid cards in the requested sidebar category", async () => {
    const repository = new CardSidebarRepository(
      stubCards({ characters: [{ type: "character", id: "elia", name: "엘리아", role: "main" }] })
    )

    const result = await repository.list(vscode.Uri.file("/workspace"), "character")

    expect(result).toEqual([
      expect.objectContaining({ id: "elia", name: "엘리아", role: "main", type: "character" })
    ])
  })

  it("keeps a card it cannot read visible as an error summary", async () => {
    const unreadable = {
      loadRoster: async () => {
        throw new Error("background/broken.card/card.yaml: 스키마가 맞지 않습니다")
      }
    } as unknown as WorkspaceCards
    const repository = new CardSidebarRepository(unreadable)

    const result = await repository.list(vscode.Uri.file("/workspace"), "background")

    expect(result[0]).toEqual(
      expect.objectContaining({ error: expect.stringContaining("broken.card"), type: "location" })
    )
  })
})

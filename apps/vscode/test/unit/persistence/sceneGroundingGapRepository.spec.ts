import { describe, expect, it } from "vitest"
import * as vscode from "vscode"

import { FindingStore, SceneGroundingGapRepository } from "@storyboard/story-engine"

import { createMemoryCaches } from "../../stubs/caches"

describe("SceneGroundingGapRepository", () => {
  it("keeps one gap per scene and forgets it when written empty", async () => {
    const caches = createMemoryCaches()
    const root = vscode.Uri.file("/ws")
    const repository = new SceneGroundingGapRepository(caches)

    await repository.write(root, "01-a", { inputKey: "key-1", fields: ["place"] })

    await expect(repository.read(root, "01-a")).resolves.toEqual({ inputKey: "key-1", fields: ["place"] })
    await repository.write(root, "01-a", undefined)
    await expect(repository.read(root, "01-a")).resolves.toBeUndefined()
  })

  it("treats a record it cannot read as no record", async () => {
    const caches = createMemoryCaches()
    const root = vscode.Uri.file("/ws")
    new FindingStore(await caches.open(root)).record({
      kind: "grounding-gap",
      subject: "01-a",
      inputHash: "key-1",
      data: { unexpected: true }
    })

    await expect(new SceneGroundingGapRepository(caches).read(root, "01-a")).resolves.toBeUndefined()
  })
})

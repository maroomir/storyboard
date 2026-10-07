import { describe, expect, it } from "vitest"
import * as vscode from "vscode"

import { SceneGroundingGapRepository, type IFileSystem } from "@storyboard/story-engine"

// `mkdir .storyboard/cache/grounding-gaps.json` used to stop every draft with EISDIR.
describe("SceneGroundingGapRepository", () => {
  it("treats a record it cannot read as no record", async () => {
    const fileSystem = {
      exists: async (): Promise<boolean> => true,
      readFile: async (): Promise<Uint8Array> => {
        throw new Error("EISDIR: illegal operation on a directory")
      }
    } as unknown as IFileSystem

    await expect(new SceneGroundingGapRepository(fileSystem).read(vscode.Uri.file("/ws"), "01-a")).resolves.toBeUndefined()
  })
})

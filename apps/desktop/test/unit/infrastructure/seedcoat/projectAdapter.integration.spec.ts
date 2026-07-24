// @vitest-environment node

import { beforeAll, describe, expect, it } from "vitest"
import { init, loadSeedcoat, save } from "@seedcoat/wasm"

import {
  decodeSeedToWritePlan,
  encodeWorkspaceToSeed,
  type WorkspaceContent
} from "@/infrastructure/seedcoat/projectAdapter"

function minimalWorkspaceContent(overrides?: Partial<WorkspaceContent>): WorkspaceContent {
  return {
    project: {
      version: "1.0.0",
      id: "00000000-0000-4000-8000-000000000001",
      name: "Round Trip Test",
      format: "novel",
      language: "ko",
      createdAt: "2026-05-13T08:00:00.000Z",
      editor: { scenePrefixDigits: 2 }
    },
    characters: [],
    backgrounds: [],
    scenes: [{ stem: "01-opening", content: "첫 장면\n" }],
    ...overrides
  }
}

async function caughtError(run: () => unknown): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error("expected the call to throw")
}

// seedcoat v2 stores each entity as a content-addressed blob object; the snapshot
// object is now a manifest of blob hashes, so tamper the blob that holds the state.
function tamperBlobObject(bytes: Uint8Array): Uint8Array {
  const lines = new TextDecoder().decode(bytes).trimEnd().split("\n")
  const tampered = lines.map((line, index) => {
    if (index === 0) {
      return line
    }

    const [pathPart, contentPart] = line.split(" ")
    const path = Buffer.from(pathPart ?? "", "base64").toString("utf8")

    if (!path.startsWith(".seed/objects/blobs/")) {
      return line
    }

    const content = Buffer.from(contentPart ?? "", "base64").toString("utf8")
    const tamperedContent = content.replace("Round Trip Test", "Tampered")
    return `${pathPart} ${Buffer.from(tamperedContent, "utf8").toString("base64")}`
  })

  return new TextEncoder().encode(`${tampered.join("\n")}\n`)
}

describe("projectAdapter (@seedcoat/wasm)", () => {
  beforeAll(async () => {
    await loadSeedcoat()
  })

  it("round-trips encode → decode", async () => {
    const content = minimalWorkspaceContent()

    const bytes = await encodeWorkspaceToSeed(content)
    const decoded = await decodeSeedToWritePlan(bytes)

    expect(decoded.project.id).toBe("00000000-0000-4000-8000-000000000001")
    expect(decoded.project.name).toBe("Round Trip Test")
    expect(decoded.scenes).toHaveLength(1)
    expect(decoded.scenes[0]?.stem).toBe("01-opening")
    expect(decoded.scenes[0]?.content).toBe("첫 장면\n")
  })

  it("rejects bytes that are not a seedcoat archive with UNSUPPORTED_FORMAT", async () => {
    const legacyBytes = new TextEncoder().encode(
      JSON.stringify({ version: "3.0.0", id: "legacy", name: "Legacy" })
    )

    expect(await caughtError(() => decodeSeedToWritePlan(legacyBytes))).toMatchObject({
      code: "UNSUPPORTED_FORMAT"
    })
  })

  it("rejects a tampered archive object with HASH_MISMATCH", async () => {
    const bytes = await encodeWorkspaceToSeed(minimalWorkspaceContent())
    const tampered = tamperBlobObject(bytes)

    expect(await caughtError(() => decodeSeedToWritePlan(tampered))).toMatchObject({
      code: "HASH_MISMATCH"
    })
  })

  it("rejects an archive without recorded notes", async () => {
    const bytes = save(init())

    await expect(decodeSeedToWritePlan(bytes)).rejects.toThrowError(/변경 이력/)
  })

  it("does not preserve character arc, recentDialogues, profile, or attributes after round-trip", async () => {
    const content = minimalWorkspaceContent({
      characters: [
        {
          type: "character",
          id: "hero",
          name: "주인공",
          role: "main",
          arc: [{ stage: "발단", summary: "시작" }],
          recentDialogues: ["안녕"],
          profile: "profile/hero.png",
          attributes: { age: 20 }
        }
      ]
    })

    const bytes = await encodeWorkspaceToSeed(content)
    const decoded = await decodeSeedToWritePlan(bytes)

    expect(decoded.characters).toHaveLength(1)
    const hero = decoded.characters[0]
    expect(hero?.id).toBe("hero")
    expect(hero?.role).toBe("main")
    expect(hero?.arc).toBeUndefined()
    expect(hero?.recentDialogues).toBeUndefined()
    expect(hero?.profile).toBeUndefined()
    expect(hero?.attributes).toBeUndefined()
  })

  it("does not preserve editor.trackDraft after round-trip", async () => {
    const content = minimalWorkspaceContent({
      project: {
        ...minimalWorkspaceContent().project,
        editor: { scenePrefixDigits: 2, trackDraft: true }
      }
    })

    const bytes = await encodeWorkspaceToSeed(content)
    const decoded = await decodeSeedToWritePlan(bytes)

    expect(decoded.project.editor.trackDraft).toBeUndefined()
  })

  it("round-trips a role-less character", async () => {
    const content = minimalWorkspaceContent({
      characters: [{ type: "character", id: "hero", name: "주인공" }]
    })

    const bytes = await encodeWorkspaceToSeed(content)
    const decoded = await decodeSeedToWritePlan(bytes)

    expect(decoded.characters).toHaveLength(1)
    expect(decoded.characters[0]?.id).toBe("hero")
    expect(decoded.characters[0]?.role).toBeUndefined()
  })

  it("drops relations without a type during seed round-trip", async () => {
    const content = minimalWorkspaceContent({
      characters: [
        {
          type: "character",
          id: "hero",
          name: "주인공",
          relations: [
            { target: "rival", type: "" },
            { target: "mentor", type: "ally" }
          ]
        },
        { type: "character", id: "rival", name: "라이벌" },
        { type: "character", id: "mentor", name: "멘토" }
      ]
    })

    const bytes = await encodeWorkspaceToSeed(content)
    const decoded = await decodeSeedToWritePlan(bytes)

    expect(decoded.characters[0]?.relations).toEqual([{ target: "mentor", type: "ally" }])
  })

  it("removes orphan background characterIds on decode", async () => {
    const content = minimalWorkspaceContent({
      characters: [
        {
          type: "character",
          id: "hero",
          name: "주인공",
          role: "main",
          traits: [],
          description: [],
          relations: []
        }
      ],
      backgrounds: [
        {
          type: "location",
          id: "cafe",
          name: "카페",
          locationKind: "place",
          characterIds: ["hero", "missing"],
          tags: [],
          description: []
        }
      ]
    })

    const bytes = await encodeWorkspaceToSeed(content)
    const decoded = await decodeSeedToWritePlan(bytes)

    expect(decoded.backgrounds[0]?.characterIds).toEqual(["hero"])
  })

  it("rejects export when a scene stem has no numeric prefix", async () => {
    const content = minimalWorkspaceContent({
      scenes: [{ stem: "opening", content: "본문\n" }]
    })

    expect(await caughtError(() => encodeWorkspaceToSeed(content))).toMatchObject({
      code: "INVALID_STATE"
    })
  })
})

// @vitest-environment node

import { describe, expect, it } from "vitest"
import { init, save } from "@seedcoat/wasm"

import {
  decodeSeedToWritePlan,
  encodeWorkspaceToSeed,
  type WorkspaceContent
} from "@/services/seedcoat/projectAdapter"

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

function caughtError(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error("expected the call to throw")
}

function tamperSnapshotObject(bytes: Uint8Array): Uint8Array {
  const lines = new TextDecoder().decode(bytes).trimEnd().split("\n")
  const tampered = lines.map((line, index) => {
    if (index === 0) {
      return line
    }

    const [pathPart, contentPart] = line.split(" ")
    const path = Buffer.from(pathPart ?? "", "base64").toString("utf8")

    if (!path.startsWith(".seed/objects/snapshots/")) {
      return line
    }

    const content = Buffer.from(contentPart ?? "", "base64").toString("utf8")
    const tamperedContent = content.replace("Round Trip Test", "Tampered")
    return `${pathPart} ${Buffer.from(tamperedContent, "utf8").toString("base64")}`
  })

  return new TextEncoder().encode(`${tampered.join("\n")}\n`)
}

describe("projectAdapter (@seedcoat/wasm)", () => {
  it("round-trips encode → decode", () => {
    const content = minimalWorkspaceContent()

    const bytes = encodeWorkspaceToSeed(content)
    const decoded = decodeSeedToWritePlan(bytes)

    expect(decoded.project.id).toBe("00000000-0000-4000-8000-000000000001")
    expect(decoded.project.name).toBe("Round Trip Test")
    expect(decoded.scenes).toHaveLength(1)
    expect(decoded.scenes[0]?.stem).toBe("01-opening")
    expect(decoded.scenes[0]?.content).toBe("첫 장면\n")
  })

  it("rejects bytes that are not a seedcoat archive with UNSUPPORTED_FORMAT", () => {
    const legacyBytes = new TextEncoder().encode(
      JSON.stringify({ version: "3.0.0", id: "legacy", name: "Legacy" })
    )

    expect(caughtError(() => decodeSeedToWritePlan(legacyBytes))).toMatchObject({
      code: "UNSUPPORTED_FORMAT"
    })
  })

  it("rejects a tampered archive object with HASH_MISMATCH", () => {
    const bytes = encodeWorkspaceToSeed(minimalWorkspaceContent())
    const tampered = tamperSnapshotObject(bytes)

    expect(caughtError(() => decodeSeedToWritePlan(tampered))).toMatchObject({
      code: "HASH_MISMATCH"
    })
  })

  it("rejects an archive without recorded notes", () => {
    const bytes = save(init())

    expect(() => decodeSeedToWritePlan(bytes)).toThrowError(/변경 이력/)
  })

  it("does not preserve character arc, recentDialogues, profile, or attributes after round-trip", () => {
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

    const bytes = encodeWorkspaceToSeed(content)
    const decoded = decodeSeedToWritePlan(bytes)

    expect(decoded.characters).toHaveLength(1)
    const hero = decoded.characters[0]
    expect(hero?.id).toBe("hero")
    expect(hero?.role).toBe("main")
    expect(hero?.arc).toBeUndefined()
    expect(hero?.recentDialogues).toBeUndefined()
    expect(hero?.profile).toBeUndefined()
    expect(hero?.attributes).toBeUndefined()
  })

  it("does not preserve editor.trackDraft after round-trip", () => {
    const content = minimalWorkspaceContent({
      project: {
        ...minimalWorkspaceContent().project,
        editor: { scenePrefixDigits: 2, trackDraft: true }
      }
    })

    const bytes = encodeWorkspaceToSeed(content)
    const decoded = decodeSeedToWritePlan(bytes)

    expect(decoded.project.editor.trackDraft).toBeUndefined()
  })

  it("round-trips a role-less character", () => {
    const content = minimalWorkspaceContent({
      characters: [{ type: "character", id: "hero", name: "주인공" }]
    })

    const bytes = encodeWorkspaceToSeed(content)
    const decoded = decodeSeedToWritePlan(bytes)

    expect(decoded.characters).toHaveLength(1)
    expect(decoded.characters[0]?.id).toBe("hero")
    expect(decoded.characters[0]?.role).toBeUndefined()
  })

  it("removes orphan background characterIds on decode", () => {
    const content = minimalWorkspaceContent({
      characters: [
        {
          type: "character",
          id: "hero",
          name: "주인공",
          role: "main",
          traits: [],
          description: "",
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
          description: ""
        }
      ]
    })

    const bytes = encodeWorkspaceToSeed(content)
    const decoded = decodeSeedToWritePlan(bytes)

    expect(decoded.backgrounds[0]?.characterIds).toEqual(["hero"])
  })

  it("rejects export when a scene stem has no numeric prefix", () => {
    const content = minimalWorkspaceContent({
      scenes: [{ stem: "opening", content: "본문\n" }]
    })

    expect(caughtError(() => encodeWorkspaceToSeed(content))).toMatchObject({
      code: "INVALID_STATE"
    })
  })
})

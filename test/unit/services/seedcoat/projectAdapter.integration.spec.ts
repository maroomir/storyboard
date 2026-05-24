// @vitest-environment node

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  decodeSeedToWritePlan,
  encodeWorkspaceToSeed,
  type WorkspaceContent
} from "@/services/seedcoat/projectAdapter"

const FIXTURE_PASSPHRASE = "seedcoat-fixture-passphrase"
const MINIMAL_SEED_PATH = join(
  process.cwd(),
  "node_modules/@seedcoat/wasm/fixtures/sealed/minimal.seed"
)

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

describe("projectAdapter (@seedcoat/wasm)", () => {
  it(
    "decodes minimal.seed fixture",
    async () => {
      const bytes = new Uint8Array(readFileSync(MINIMAL_SEED_PATH))
      const content = await decodeSeedToWritePlan(bytes, FIXTURE_PASSPHRASE)

      expect(content.project.id).toBe("proj")
      expect(content.project.name).toBe("Demo")
      expect(content.project.format).toBe("novel")
    },
    30_000
  )

  it(
    "rejects wrong passphrase with DECRYPTION_FAILED",
    async () => {
      const bytes = new Uint8Array(readFileSync(MINIMAL_SEED_PATH))

      await expect(decodeSeedToWritePlan(bytes, "wrong-passphrase")).rejects.toMatchObject({
        code: "DECRYPTION_FAILED"
      })
    },
    30_000
  )

  it(
    "rejects legacy plaintext with LEGACY_FORMAT_REJECTED",
    async () => {
      const legacyBytes = new TextEncoder().encode(
        JSON.stringify({ version: "3.0.0", id: "legacy", name: "Legacy" })
      )

      await expect(decodeSeedToWritePlan(legacyBytes, FIXTURE_PASSPHRASE)).rejects.toMatchObject({
        code: "LEGACY_FORMAT_REJECTED"
      })
    },
    30_000
  )

  it(
    "round-trips encode → decode",
    async () => {
      const content = minimalWorkspaceContent()

      const bytes = await encodeWorkspaceToSeed(content, FIXTURE_PASSPHRASE)
      const decoded = await decodeSeedToWritePlan(bytes, FIXTURE_PASSPHRASE)

      expect(decoded.project.id).toBe("00000000-0000-4000-8000-000000000001")
      expect(decoded.project.name).toBe("Round Trip Test")
      expect(decoded.scenes).toHaveLength(1)
      expect(decoded.scenes[0]?.stem).toBe("01-opening")
      expect(decoded.scenes[0]?.content).toBe("첫 장면\n")
    },
    30_000
  )

  it(
    "does not preserve character arc, profile, or attributes after round-trip",
    async () => {
      const content = minimalWorkspaceContent({
        characters: [
          {
            type: "character",
            id: "hero",
            name: "주인공",
            role: "lead",
            arc: [{ stage: "발단", summary: "시작" }],
            recentDialogues: ["안녕"],
            profile: "profile/hero.png",
            attributes: { age: 20 }
          }
        ]
      })

      const bytes = await encodeWorkspaceToSeed(content, FIXTURE_PASSPHRASE)
      const decoded = await decodeSeedToWritePlan(bytes, FIXTURE_PASSPHRASE)

      expect(decoded.characters).toHaveLength(1)
      const hero = decoded.characters[0]
      expect(hero?.id).toBe("hero")
      expect(hero?.arc).toBeUndefined()
      expect(hero?.recentDialogues).toBeUndefined()
      expect(hero?.profile).toBeUndefined()
      expect(hero?.attributes).toBeUndefined()
    },
    30_000
  )

  it(
    "round-trips a role-less character (encoder emits role='', decode drops it)",
    async () => {
      const content = minimalWorkspaceContent({
        characters: [{ type: "character", id: "hero", name: "주인공" }]
      })

      const bytes = await encodeWorkspaceToSeed(content, FIXTURE_PASSPHRASE)
      const decoded = await decodeSeedToWritePlan(bytes, FIXTURE_PASSPHRASE)

      expect(decoded.characters).toHaveLength(1)
      expect(decoded.characters[0]?.id).toBe("hero")
      expect(decoded.characters[0]?.role).toBeUndefined()
    },
    30_000
  )

  it(
    "drops relations without a type during seed round-trip",
    async () => {
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

      const bytes = await encodeWorkspaceToSeed(content, FIXTURE_PASSPHRASE)
      const decoded = await decodeSeedToWritePlan(bytes, FIXTURE_PASSPHRASE)

      expect(decoded.characters[0]?.relations).toEqual([{ target: "mentor", type: "ally" }])
    },
    30_000
  )

  it(
    "removes orphan background characterIds on decode",
    async () => {
      const content = minimalWorkspaceContent({
        characters: [
          {
            type: "character",
            id: "hero",
            name: "주인공",
            role: "lead",
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

      const bytes = await encodeWorkspaceToSeed(content, FIXTURE_PASSPHRASE)
      const decoded = await decodeSeedToWritePlan(bytes, FIXTURE_PASSPHRASE)

      expect(decoded.backgrounds[0]?.characterIds).toEqual(["hero"])
    },
    30_000
  )

  it(
    "rejects export when scene stem does not match two-digit prefix constraint",
    async () => {
      const content = minimalWorkspaceContent({
        scenes: [{ stem: "1-opening", content: "본문\n" }]
      })

      await expect(encodeWorkspaceToSeed(content, FIXTURE_PASSPHRASE)).rejects.toMatchObject({
        code: "SCHEMA_VIOLATION"
      })
    },
    30_000
  )

})

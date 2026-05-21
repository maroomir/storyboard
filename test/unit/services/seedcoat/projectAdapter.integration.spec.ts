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
      const content: WorkspaceContent = {
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
        scenes: [{ stem: "01-opening", content: "첫 장면\n" }]
      }

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
})

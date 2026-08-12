import { describe, expect, it } from "vitest"

import {
  createDefaultProjectJson,
  parseProjectJson,
  serializeProjectJson
} from "@/infrastructure/persistence/projectJson"
import type { StoryboardProject } from '@seedkernel/wasm';

function baseProject(): StoryboardProject {
  return createDefaultProjectJson({ name: "MagicBoy" })
}

describe("projectJson contract fields", () => {
  it("round-trips the generation contract setting", () => {
    const project: StoryboardProject = {
      ...baseProject(),
      setting: {
        genre: "성장 판타지",
        tags: ["학원"],
        audience: "10대 후반",
        targetWordCount: 120_000,
        pov: "third-limited",
        prohibitions: ["과도한 폭력"]
      }
    }

    const parsed = parseProjectJson(serializeProjectJson(project))

    expect(parsed.setting).toMatchObject({
      genre: "성장 판타지",
      audience: "10대 후반",
      targetWordCount: 120_000,
      pov: "third-limited",
      prohibitions: ["과도한 폭력"]
    })
  })

  it("parses a legacy project.json without the new contract fields", () => {
    const project = baseProject()
    const legacyRaw = JSON.stringify({
      ...project,
      setting: { genre: "판타지", tags: ["학원"] }
    })

    const parsed = parseProjectJson(legacyRaw)

    expect(parsed.setting?.prohibitions).toEqual([])
    expect(parsed.setting?.pov).toBeUndefined()
    expect(parsed.setting?.targetWordCount).toBeUndefined()
  })

  it("rejects an invalid point of view", () => {
    const project = baseProject()
    const invalidRaw = JSON.stringify({
      ...project,
      setting: { tags: [], prohibitions: [], pov: "omniscient" }
    })

    expect(() => parseProjectJson(invalidRaw)).toThrow()
  })
})

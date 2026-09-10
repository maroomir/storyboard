import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import promptTuningTable from "../../../../../packages/story-ai/src/ai/prompts/promptTuning.params.json"

const promptsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/story-ai/src/ai/prompts"
)

const promptModules = readdirSync(promptsDirectory)
  .filter((name) => name.endsWith(".ts") && name !== "types.ts" && name !== "promptTuning.ts")
  .map((name) => ({
    stem: name.replace(/\.ts$/, ""),
    source: readFileSync(path.join(promptsDirectory, name), "utf8")
  }))

// temperature 와 maxTokens 가 프롬프트 파일마다 흩어져 있으면 «검사류는 낮게, 창작류는 높게»라는
// 결이 지켜지는지 볼 곳이 없다. 표와 파일이 따로 놀기 시작하는 순간을 여기서 잡는다.
describe("prompt tuning table", () => {
  it("names a real prompt module for every entry", () => {
    const stems = new Set(promptModules.map((module) => module.stem))

    for (const key of Object.keys(promptTuningTable)) {
      expect(stems.has(key), `${key} has no prompt module`).toBe(true)
    }
  })

  it("keeps every prompt reading its own entry, not a literal", () => {
    for (const module of promptModules) {
      if (!module.source.includes("config:")) {
        continue
      }

      expect(module.source, `${module.stem} still spells its config out`).toContain(
        `config: promptTuning('${module.stem}')`
      )
    }
  })

  it("keeps every entry inside a usable range", () => {
    for (const [key, config] of Object.entries(promptTuningTable)) {
      expect(config.temperature, `${key} temperature`).toBeGreaterThanOrEqual(0)
      expect(config.temperature, `${key} temperature`).toBeLessThanOrEqual(1)
      expect(config.maxTokens, `${key} maxTokens`).toBeGreaterThan(0)
    }
  })
})

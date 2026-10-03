import yaml from "js-yaml"
import { describe, expect, it } from "vitest"

import { migrateCardTextFieldsToList } from "@storyboard/story-model"

describe("migrateCardTextFieldsToList", () => {
  it("converts string voice and description into lists", () => {
    const rawYaml = ["type: character", "id: elia", "name: 엘리아", "voice: 느린 말투", "description: 주인공"].join("\n")

    const result = migrateCardTextFieldsToList(rawYaml)

    expect(result.changed).toBe(true)
    const parsed = yaml.load(result.yaml) as Record<string, unknown>
    expect(parsed.voice).toEqual(["느린 말투"])
    expect(parsed.description).toEqual(["주인공"])
  })

  it("splits multi-line block strings into multiple items", () => {
    const rawYaml = ["type: character", "id: elia", "name: 엘리아", "description: |-", "  주인공.", "  17세 여학생."].join(
      "\n"
    )

    const result = migrateCardTextFieldsToList(rawYaml)

    expect(result.changed).toBe(true)
    const parsed = yaml.load(result.yaml) as Record<string, unknown>
    expect(parsed.description).toEqual(["주인공.", "17세 여학생."])
  })

  it("leaves already list-form cards unchanged", () => {
    const rawYaml = ["type: character", "id: elia", "name: 엘리아", "description:", "  - 주인공"].join("\n")

    const result = migrateCardTextFieldsToList(rawYaml)

    expect(result.changed).toBe(false)
    expect(result.yaml).toBe(rawYaml)
  })
})

import { describe, expect, it } from "vitest"

import {
  defaultPipelineSpec,
  parsePipelineSpec,
  renderPipelineSpec,
  resolvePipelinePlan,
  type PipelineStageDefinition
} from "@storyboard/story-format"

const catalog: readonly PipelineStageDefinition[] = [
  { id: "prepare", label: "준비", required: true },
  { id: "draft", label: "초안", required: true, requires: ["prepare"] },
  { id: "polish", label: "다듬기", requires: ["draft"] },
  { id: "record", label: "기록", requires: ["draft"] }
]

describe("pipeline spec", () => {
  it("parses a plain list and an entry that switches a stage off", () => {
    const spec = parsePipelineSpec("version: 1\nstages:\n  - prepare\n  - draft\n  - id: polish\n    enabled: false\n  - record\n")

    expect(resolvePipelinePlan(spec, catalog)).toEqual(["prepare", "draft", "record"])
  })

  it("round-trips the default spec through YAML", () => {
    const spec = defaultPipelineSpec(catalog)

    expect(resolvePipelinePlan(parsePipelineSpec(renderPipelineSpec(spec)), catalog)).toEqual([
      "prepare",
      "draft",
      "polish",
      "record"
    ])
  })

  it("rejects text that is not YAML, and YAML that is not a spec", () => {
    expect(() => parsePipelineSpec("stages: [")).toThrow("YAML")
    expect(() => parsePipelineSpec("version: 2\nstages: [draft]\n")).toThrow("꼴이 맞지 않습니다")
    expect(() => parsePipelineSpec("version: 1\nstages: []\n")).toThrow("꼴이 맞지 않습니다")
  })

  it("names an unknown or repeated stage", () => {
    expect(() =>
      resolvePipelinePlan({ version: 1, stages: ["prepare", "draft", "sing"] }, catalog)
    ).toThrow("알 수 없는 단계입니다: sing")
    expect(() =>
      resolvePipelinePlan({ version: 1, stages: ["prepare", "draft", "draft"] }, catalog)
    ).toThrow("두 번")
  })

  it("refuses to drop a required stage or to run a stage before what it needs", () => {
    expect(() => resolvePipelinePlan({ version: 1, stages: ["prepare", "polish"] }, catalog)).toThrow(
      "빠뜨릴 수 없는 단계입니다: draft"
    )
    expect(() =>
      resolvePipelinePlan({ version: 1, stages: ["prepare", { id: "draft", enabled: false }] }, catalog)
    ).toThrow("빠뜨릴 수 없는 단계입니다: draft")
    expect(() =>
      resolvePipelinePlan({ version: 1, stages: ["prepare", "polish", "draft"] }, catalog)
    ).toThrow("polish 단계는 draft 단계가 먼저")
  })
})

import { describe, expect, it } from "vitest"

import { SceneCoveragePrompt } from "@/infrastructure/ai/prompts/sceneCoverage"

const beats = ["엘리아가 복도를 걷는다.", "잠긴 문 앞에 선다.", "문이 열린다."]
const draft = "엘리아는 복도를 천천히 걸었다. 문이 스르륵 열렸다."

describe("SceneCoveragePrompt", () => {
  it("builds a generic prompt with the coverage instruction, JSON shape, numbered beats, and draft", () => {
    const artifact = SceneCoveragePrompt.build(beats, draft, "generic")

    expect(artifact.system).toContain("missing")
    expect(artifact.system).toContain("out-of-order")
    expect(artifact.system).toContain('"status":"missing"')

    expect(artifact.user).toContain("1. 엘리아가 복도를 걷는다.")
    expect(artifact.user).toContain("2. 잠긴 문 앞에 선다.")
    expect(artifact.user).toContain("3. 문이 열린다.")
    expect(artifact.user).toContain(draft)
  })

  it("builds an xs prompt that stays shorter but keeps the JSON shape, numbered beats, and draft", () => {
    const generic = SceneCoveragePrompt.build(beats, draft, "generic")
    const xs = SceneCoveragePrompt.build(beats, draft, "xs")

    expect(xs.system.length).toBeLessThan(generic.system.length)
    expect(xs.system).toContain('"status":"missing"')

    expect(xs.user).toContain("1. 엘리아가 복도를 걷는다.")
    expect(xs.user).toContain("2. 잠긴 문 앞에 선다.")
    expect(xs.user).toContain(draft)
  })
})

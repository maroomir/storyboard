import { describe, expect, it } from "vitest"

import { coerceStudioAgentAction, coerceStudioValidationVerdict } from "@storyboard/story-ai"

describe("coerceStudioAgentAction", () => {
  it("reads a JSON object out of surrounding prose", () => {
    expect(coerceStudioAgentAction('네, 이렇게요:\n{"kind":"say","message":"알겠습니다"}')).toEqual({
      kind: "say",
      message: "알겠습니다"
    })
  })

  it("rejects an unknown action kind", () => {
    expect(coerceStudioAgentAction('{"kind":"delete","path":"card"}')).toBeUndefined()
  })

  it("rejects a say with no message", () => {
    expect(coerceStudioAgentAction('{"kind":"say","message":"   "}')).toBeUndefined()
  })

  it("keeps an ask without options", () => {
    expect(coerceStudioAgentAction('{"kind":"ask","question":"어느 쪽인가요?"}')).toEqual({
      kind: "ask",
      question: "어느 쪽인가요?",
      options: []
    })
  })

  it("caps ask options at four", () => {
    const action = coerceStudioAgentAction(
      '{"kind":"ask","question":"?","options":["1","2","3","4","5","6"]}'
    )

    expect(action?.kind === "ask" ? action.options : []).toEqual(["1", "2", "3", "4"])
  })

  it("drops lookup requests with an unknown kind", () => {
    const action = coerceStudioAgentAction(
      '{"kind":"lookup","requests":[{"kind":"manuscript","key":"x"},{"kind":"scene","key":"01-intro"}]}'
    )

    expect(action).toEqual({ kind: "lookup", requests: [{ kind: "scene", key: "01-intro" }] })
  })

  it("rejects a lookup with no usable request", () => {
    expect(
      coerceStudioAgentAction('{"kind":"lookup","requests":[{"kind":"manuscript","key":"x"}]}')
    ).toBeUndefined()
  })

  it("rejects a proposal without a summary", () => {
    expect(
      coerceStudioAgentAction(
        '{"kind":"propose","patch":{"target":"card","changes":[{"field":"traits","value":["냉소적"]}]}}'
      )
    ).toBeUndefined()
  })

  it("rejects a proposal whose patch targets an unknown file kind", () => {
    expect(
      coerceStudioAgentAction('{"kind":"propose","summary":"x","patch":{"target":"canon"}}')
    ).toBeUndefined()
  })

  it("drops card changes without a field name", () => {
    const action = coerceStudioAgentAction(
      '{"kind":"propose","summary":"x","patch":{"target":"card","changes":[{"value":"y"},{"field":"role","value":"main"}]}}'
    )

    expect(action?.kind === "propose" ? action.patch : undefined).toEqual({
      target: "card",
      changes: [{ field: "role", value: "main" }]
    })
  })

  it("rejects a draft replacement whose range runs backwards", () => {
    expect(
      coerceStudioAgentAction(
        '{"kind":"propose","summary":"x","patch":{"target":"draft","replacements":[{"startOffset":30,"endOffset":10,"newText":"y"}]}}'
      )
    ).toBeUndefined()
  })

  it("rejects a draft replacement with a fractional offset", () => {
    expect(
      coerceStudioAgentAction(
        '{"kind":"propose","summary":"x","patch":{"target":"draft","replacements":[{"startOffset":1.5,"endOffset":10,"newText":"y"}]}}'
      )
    ).toBeUndefined()
  })

  it("accepts a draft replacement that inserts without deleting", () => {
    const action = coerceStudioAgentAction(
      '{"kind":"propose","summary":"x","patch":{"target":"draft","replacements":[{"startOffset":5,"endOffset":5,"newText":"덧붙임"}]}}'
    )

    expect(action?.kind).toBe("propose")
  })
})

describe("coerceStudioValidationVerdict", () => {
  it("accepts plain string warnings", () => {
    expect(coerceStudioValidationVerdict('{"warnings":["시간선이 어긋납니다"]}')).toEqual({
      state: "warn",
      warnings: [{ message: "시간선이 어긋납니다" }]
    })
  })

  it("caps the warning list at five", () => {
    const warnings = JSON.stringify({ warnings: ["a", "b", "c", "d", "e", "f", "g"] })

    expect(coerceStudioValidationVerdict(warnings).warnings).toHaveLength(5)
  })

  it("passes on an empty warning list", () => {
    expect(coerceStudioValidationVerdict('{"warnings":[]}')).toEqual({
      state: "pass",
      warnings: []
    })
  })
})

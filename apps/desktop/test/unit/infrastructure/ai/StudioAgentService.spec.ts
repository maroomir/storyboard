import { describe, expect, it } from "vitest"

import { StudioAgentService } from "@storyboard/story-ai"
import type { AiTextGateway, StudioAgentRunInput } from "@storyboard/story-ai"

interface RecordedCall {
  readonly taskName: string
  readonly system: string
  readonly user: string
}

class FakeGateway {
  public readonly calls: RecordedCall[] = []

  public constructor(private readonly responses: string[]) {}

  public async generate(
    taskName: string,
    messages: ReadonlyArray<{ role: string; content: string }>
  ): Promise<{ text: string }> {
    this.calls.push({
      taskName,
      system: messages.find((message) => message.role === "system")?.content ?? "",
      user: messages.find((message) => message.role === "user")?.content ?? ""
    })

    return { text: this.responses[this.calls.length - 1] ?? "" }
  }
}

function serviceWith(responses: string[]): {
  service: StudioAgentService
  gateway: FakeGateway
} {
  const gateway = new FakeGateway(responses)
  return { service: new StudioAgentService(gateway as unknown as AiTextGateway), gateway }
}

const characterRun: StudioAgentRunInput = {
  entityKind: "character",
  entityLabel: "서린",
  targetFile: "character/seorin.card",
  context: "id: seorin\nname: 서린",
  history: [],
  instruction: "과거사를 보강해줘",
  hasSelection: false,
  remainingQuestions: 5
}

describe("StudioAgentService.run", () => {
  it("returns a free-form remark", async () => {
    const { service } = serviceWith(['{"kind":"say","message":"이 카드에는 과거사가 없습니다."}'])

    await expect(service.run(characterRun)).resolves.toEqual({
      kind: "say",
      message: "이 카드에는 과거사가 없습니다."
    })
  })

  it("returns a question with its options", async () => {
    const { service } = serviceWith([
      '{"kind":"ask","question":"어떤 축을 보강할까요?","options":["성격","과거사"]}'
    ])

    await expect(service.run(characterRun)).resolves.toEqual({
      kind: "ask",
      question: "어떤 축을 보강할까요?",
      options: ["성격", "과거사"]
    })
  })

  it("turns a question into a remark once the question budget is spent", async () => {
    const { service, gateway } = serviceWith([
      '{"kind":"ask","question":"어떤 축을 보강할까요?","options":["성격"]}'
    ])

    await expect(service.run({ ...characterRun, remainingQuestions: 0 })).resolves.toEqual({
      kind: "say",
      message: "어떤 축을 보강할까요?"
    })
    expect(gateway.calls[0]?.system).toContain("되물을 기회를 모두 썼다")
  })

  it("returns a card patch proposal", async () => {
    const { service } = serviceWith([
      '{"kind":"propose","summary":"과거사 추가","patch":{"target":"card","changes":[{"field":"description","value":["12세에 화재를 겪었다"]}]}}'
    ])

    await expect(service.run(characterRun)).resolves.toEqual({
      kind: "propose",
      summary: "과거사 추가",
      patch: {
        target: "card",
        changes: [{ field: "description", value: ["12세에 화재를 겪었다"] }]
      }
    })
  })

  it("returns a draft replacement proposal", async () => {
    const { service } = serviceWith([
      '{"kind":"propose","summary":"구간 수정","patch":{"target":"draft","replacements":[{"startOffset":10,"endOffset":20,"newText":"고친 문장"}]}}'
    ])

    const action = await service.run({
      ...characterRun,
      entityKind: "scene",
      targetFile: "draft/01-intro.md",
      hasSelection: true
    })

    expect(action).toEqual({
      kind: "propose",
      summary: "구간 수정",
      patch: {
        target: "draft",
        replacements: [{ startOffset: 10, endOffset: 20, newText: "고친 문장" }]
      }
    })
  })

  it("resolves a lookup and feeds the result back into the next call", async () => {
    const { service, gateway } = serviceWith([
      '{"kind":"lookup","requests":[{"kind":"character","key":"jiho"}],"reason":"관계 확인"}',
      '{"kind":"propose","summary":"과거사 추가","patch":{"target":"card","changes":[{"field":"description","value":["지호와 함께 겪었다"]}]}}'
    ])

    const action = await service.run({
      ...characterRun,
      resolveLookup: async (requests) => `[조회] ${requests[0]?.key}: name: 지호`
    })

    expect(action.kind).toBe("propose")
    expect(gateway.calls).toHaveLength(2)
    expect(gateway.calls[1]?.user).toContain("[조회] jiho: name: 지호")
  })

  it("asks the author instead when no lookup resolver is wired", async () => {
    const { service } = serviceWith([
      '{"kind":"lookup","requests":[{"kind":"character","key":"jiho"}]}'
    ])

    const action = await service.run(characterRun)

    expect(action.kind).toBe("say")
    expect(action.kind === "say" ? action.message : "").toContain("jiho")
  })

  it("stops looking up after the round cap", async () => {
    const lookup = '{"kind":"lookup","requests":[{"kind":"character","key":"jiho"}]}'
    const { service, gateway } = serviceWith([lookup, lookup, lookup, lookup, lookup])

    const action = await service.run({ ...characterRun, resolveLookup: async () => "없음" })

    expect(action.kind).toBe("say")
    expect(gateway.calls).toHaveLength(4)
  })

  it("degrades to a remark when the response is not readable", async () => {
    const { service } = serviceWith(["도와드릴게요!"])

    const action = await service.run(characterRun)

    expect(action).toEqual({
      kind: "say",
      message: "응답을 이해하지 못했어요. 조금 더 구체적으로 말씀해 주시겠어요?"
    })
  })

  it("carries the conversation and the single-file constraint into the prompt", async () => {
    const { service, gateway } = serviceWith(['{"kind":"say","message":"네"}'])

    await service.run({
      ...characterRun,
      history: [
        { role: "user", text: "과거사 보강해줘" },
        { role: "assistant", text: "어떤 축을 보강할까요?" }
      ]
    })

    expect(gateway.calls[0]?.taskName).toBe("studioAgent")
    expect(gateway.calls[0]?.system).toContain("character/seorin.card 한 파일만 고칠 수 있다")
    expect(gateway.calls[0]?.user).toContain("작가: 과거사 보강해줘")
    expect(gateway.calls[0]?.user).toContain("조수: 어떤 축을 보강할까요?")
  })
})

describe("StudioAgentService.validate", () => {
  it("passes when the model reports no conflict", async () => {
    const { service, gateway } = serviceWith(['{"warnings":[]}'])

    await expect(
      service.validate({
        entityLabel: "서린",
        context: "씬 3: 서린이 불을 다룬다",
        summary: "과거사 추가",
        diff: "+ 화재 트라우마"
      })
    ).resolves.toEqual({ state: "pass", warnings: [] })
    expect(gateway.calls[0]?.taskName).toBe("studioValidation")
  })

  it("reports the conflicts the model found", async () => {
    const { service } = serviceWith([
      '{"warnings":[{"message":"씬 3에서 불을 아무렇지 않게 다룹니다","source":"scene/03.card"}]}'
    ])

    await expect(
      service.validate({ entityLabel: "서린", context: "", summary: "", diff: "" })
    ).resolves.toEqual({
      state: "warn",
      warnings: [{ message: "씬 3에서 불을 아무렇지 않게 다룹니다", source: "scene/03.card" }]
    })
  })

  it("skips rather than inventing a verdict when the response is unreadable", async () => {
    const { service } = serviceWith(["충돌 없음"])

    await expect(
      service.validate({ entityLabel: "서린", context: "", summary: "", diff: "" })
    ).resolves.toEqual({ state: "skipped", warnings: [] })
  })
})

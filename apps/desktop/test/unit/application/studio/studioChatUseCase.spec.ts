import { describe, expect, it, vi } from "vitest"

import {
  StudioChatUseCase,
  hashBaseline,
  type StudioChatRequest
} from "@/application/studio/studioChatUseCase"
import type { AiGateway } from "@/application/ai/aiGateway"
import type { StoryboardLogger } from "@/infrastructure/vscode/logger"
import type { StudioChatTurn } from "@/shared/messaging"

interface FakeServiceOptions {
  readonly action: unknown
  readonly verdict?: unknown
  readonly validateThrows?: boolean
}

function gatewayWith(options: FakeServiceOptions): {
  gateway: AiGateway
  runInputs: unknown[]
  validateInputs: unknown[]
} {
  const runInputs: unknown[] = []
  const validateInputs: unknown[] = []

  const service = {
    runStudioAgent: async (input: unknown): Promise<unknown> => {
      runInputs.push(input)
      return options.action
    },
    validateStudioProposal: async (input: unknown): Promise<unknown> => {
      validateInputs.push(input)
      if (options.validateThrows) {
        throw new Error("provider down")
      }
      return options.verdict ?? { state: "pass", warnings: [] }
    }
  }

  return {
    gateway: { createService: () => service } as unknown as AiGateway,
    runInputs,
    validateInputs
  }
}

const logger = { warn: vi.fn(), info: vi.fn() } as unknown as StoryboardLogger

const cardBaseline = "type: character\nid: seorin\nname: 서린"

function requestWith(
  gateway: AiGateway,
  overrides: Partial<StudioChatRequest> = {}
): StudioChatRequest {
  void gateway
  let counter = 0

  return {
    workspaceRoot: { toString: () => "file:///workspace" } as never,
    entityContext: {
      agentEntityKind: "character",
      entityLabel: "seorin",
      targetFile: "character/seorin.card",
      context: "카드 자료",
      baseline: cardBaseline
    },
    history: [],
    instruction: "과거사 보강해줘",
    hasSelection: false,
    isValidationEnabled: true,
    resolveLookup: async () => "",
    createTurnId: (): string => `turn-${(counter += 1)}`,
    ...overrides
  }
}

const proposeAction = {
  kind: "propose",
  summary: "과거사 추가",
  patch: { target: "card", changes: [{ field: "description", value: ["화재"] }] }
}

describe("StudioChatUseCase", () => {
  it("turns a remark into a say turn", async () => {
    const { gateway } = gatewayWith({ action: { kind: "say", message: "아직 없습니다." } })

    const turns = await new StudioChatUseCase(gateway, logger).send(requestWith(gateway))

    expect(turns).toEqual([
      { id: "turn-1", role: "assistant", kind: "say", message: "아직 없습니다." }
    ])
  })

  it("turns a question into an ask turn with its options", async () => {
    const { gateway } = gatewayWith({
      action: { kind: "ask", question: "어느 축인가요?", options: ["성격"] }
    })

    const turns = await new StudioChatUseCase(gateway, logger).send(requestWith(gateway))

    expect(turns[0]).toEqual({
      id: "turn-1",
      role: "assistant",
      kind: "ask",
      question: "어느 축인가요?",
      options: ["성격"]
    })
  })

  it("stamps the proposal with the baseline hash and the verdict", async () => {
    const { gateway } = gatewayWith({ action: proposeAction })

    const turns = await new StudioChatUseCase(gateway, logger).send(requestWith(gateway))

    expect(turns[0]).toMatchObject({
      kind: "proposal",
      summary: "과거사 추가",
      baselineHash: hashBaseline(cardBaseline),
      validation: { state: "pass", warnings: [] },
      status: "pending"
    })
  })

  it("carries the model's conflict warnings onto the proposal", async () => {
    const { gateway } = gatewayWith({
      action: proposeAction,
      verdict: { state: "warn", warnings: [{ message: "씬 3과 어긋납니다" }] }
    })

    const turns = await new StudioChatUseCase(gateway, logger).send(requestWith(gateway))

    expect(turns[0]).toMatchObject({
      validation: { state: "warn", warnings: [{ message: "씬 3과 어긋납니다" }] }
    })
  })

  it("skips the validation pass when the setting is off", async () => {
    const { gateway, validateInputs } = gatewayWith({ action: proposeAction })

    const turns = await new StudioChatUseCase(gateway, logger).send(
      requestWith(gateway, { isValidationEnabled: false })
    )

    expect(validateInputs).toHaveLength(0)
    expect(turns[0]).toMatchObject({ validation: { state: "skipped", warnings: [] } })
  })

  it("degrades to skipped rather than failing when validation errors", async () => {
    const { gateway } = gatewayWith({ action: proposeAction, validateThrows: true })

    const turns = await new StudioChatUseCase(gateway, logger).send(requestWith(gateway))

    expect(turns[0]).toMatchObject({ validation: { state: "skipped", warnings: [] } })
  })

  it("refuses to propose against a file that does not exist", async () => {
    const { gateway } = gatewayWith({ action: proposeAction })

    const turns = await new StudioChatUseCase(gateway, logger).send(
      requestWith(gateway, {
        entityContext: {
          agentEntityKind: "scene",
          entityLabel: "01-intro",
          targetFile: "draft/01-intro.md",
          context: "씬 자료",
          baseline: undefined
        }
      })
    )

    const turn = turns[0]

    expect(turn).toMatchObject({ kind: "say" })
    expect(turn?.role === "assistant" && turn.kind === "say" ? turn.message : "").toContain(
      "draft/01-intro.md"
    )
  })

  it("spends the question budget as the session accumulates asks", async () => {
    const { gateway, runInputs } = gatewayWith({ action: { kind: "say", message: "네" } })

    const history: StudioChatTurn[] = [
      { id: "a1", role: "assistant", kind: "ask", question: "1?", options: [] },
      { id: "a2", role: "assistant", kind: "ask", question: "2?", options: [] }
    ]

    await new StudioChatUseCase(gateway, logger).send(requestWith(gateway, { history }))

    expect((runInputs[0] as { remainingQuestions: number }).remainingQuestions).toBe(3)
  })

  it("stops offering questions once five have been asked", async () => {
    const { gateway, runInputs } = gatewayWith({ action: { kind: "say", message: "네" } })

    const history: StudioChatTurn[] = Array.from({ length: 6 }, (_, index) => ({
      id: `a${index}`,
      role: "assistant" as const,
      kind: "ask" as const,
      question: "?",
      options: []
    }))

    await new StudioChatUseCase(gateway, logger).send(requestWith(gateway, { history }))

    expect((runInputs[0] as { remainingQuestions: number }).remainingQuestions).toBe(0)
  })

  it("replays the conversation to the agent as labelled messages", async () => {
    const { gateway, runInputs } = gatewayWith({ action: { kind: "say", message: "네" } })

    const history: StudioChatTurn[] = [
      { id: "u1", role: "user", text: "보강해줘" },
      { id: "a1", role: "assistant", kind: "ask", question: "어느 축?", options: [] },
      {
        id: "p1",
        role: "assistant",
        kind: "proposal",
        summary: "과거사 추가",
        patch: { target: "card", changes: [{ field: "description", value: ["화재"] }] },
        baselineHash: "hash",
        validation: { state: "pass", warnings: [] },
        status: "applied"
      }
    ]

    await new StudioChatUseCase(gateway, logger).send(requestWith(gateway, { history }))

    expect((runInputs[0] as { history: unknown }).history).toEqual([
      { role: "user", text: "보강해줘" },
      { role: "assistant", text: "어느 축?" },
      { role: "assistant", text: "제안(applied): 과거사 추가" }
    ])
  })
})

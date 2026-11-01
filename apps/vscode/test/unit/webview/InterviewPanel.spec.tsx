import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InterviewPanel } from "@webview/components/editor/InterviewPanel"
import type { InterviewOpening, InterviewQuestion, StoryboardCard } from "@webview/lib/types"

const card: StoryboardCard = { type: "character", id: "hana", name: "하나", role: "main" }

const opening: InterviewOpening = {
  sessionId: "s1",
  cardId: "hana",
  cardType: "character",
  name: "하나",
  coverage: {
    cardId: "hana",
    cardType: "character",
    name: "하나",
    hasWorkingModel: false,
    openAxes: [{ axisId: "pressure", axisLabel: "압박 아래 방어", beatSituations: [] }],
    upcomingSceneStems: ["12-night"]
  },
  isContractStale: false,
  maxQuestions: 12
}

const question: InterviewQuestion = {
  id: "q1",
  sessionId: "s1",
  axisId: "pressure",
  axisLabel: "압박 아래 방어",
  values: [
    { id: "counter", label: "역공" },
    { id: "withhold", label: "침묵" }
  ],
  source: { kind: "beat", sceneStem: "12-night", beatIndex: 2 },
  situation: "준이 하나를 심문한다",
  question: "하나의 첫 반응은?",
  options: [
    { valueId: "counter", text: "“물어볼 게 그게 다예요?”", isExploration: false },
    { valueId: "withhold", text: "잔을 내려놓고 침묵한다", isExploration: false }
  ]
}

async function respond(postMessage: ReturnType<typeof vi.fn>, method: string, payload: unknown): Promise<void> {
  const request = await waitFor(() => {
    const pending = postMessage.mock.calls.map((call) => call[0]).find((message) => message.method === method && !message.answered)
    if (pending === undefined) {
      throw new Error(`no pending ${method} request`)
    }
    return pending
  })
  request.answered = true
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", id: request.id, ok: true, payload } }))
    await Promise.resolve()
  })
}

function methodsCalled(postMessage: ReturnType<typeof vi.fn>): string[] {
  return postMessage.mock.calls.map((call) => call[0].method)
}

describe("InterviewPanel", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("starts a session, shows one question, records a chosen answer, and finishes on 여기까지", async () => {
    const postMessage = vi.fn()
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
    const statuses: string[] = []
    render(<InterviewPanel card={card} documentUri="file:///ws/character/hana.card" vscodeApi={{ postMessage } as never} onStatusChange={(status) => statuses.push(status)} />)

    fireEvent.click(screen.getByRole("button", { name: "인터뷰 시작" }))
    await respond(postMessage, "interviews.start", { opening })
    await respond(postMessage, "interviews.next", { question })

    expect(await screen.findByText("하나의 첫 반응은?")).toBeTruthy()
    expect(screen.getByText(/압박 아래 방어 \(12-night · 사건 3\)/)).toBeTruthy()

    fireEvent.click(screen.getByText("잔을 내려놓고 침묵한다"))
    const answerRequest = postMessage.mock.calls.map((call) => call[0]).find((message) => message.method === "interviews.answer")
    expect(answerRequest.payload).toMatchObject({ sessionId: "s1", questionId: "q1", answer: { kind: "chosen", index: 1 } })
    await respond(postMessage, "interviews.answer", { outcome: { isRebuilt: false, answeredCount: 1 } })
    await respond(postMessage, "interviews.next", { question: { ...question, id: "q2" } })

    expect(await screen.findByText(/1\/12 답/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "여기까지" }))
    await respond(postMessage, "interviews.finish", {
      summary: { sessionId: "s1", cardId: "hana", answered: 1, skipped: 0, candidateCount: 2, undecidedAxisLabels: ["호감 표출"] }
    })

    expect(await screen.findByText(/카드 후보 2건/)).toBeTruthy()
    expect(screen.getByText(/아직 정해지지 않은 축: 호감 표출/)).toBeTruthy()
    expect(methodsCalled(postMessage)).toEqual(["interviews.start", "interviews.next", "interviews.answer", "interviews.next", "interviews.finish"])
    expect(statuses.at(-1)).toContain("카드 후보 2건")
  })

  it("asks the writer to confirm how a written answer was read and sends the rename", async () => {
    const postMessage = vi.fn()
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
    render(<InterviewPanel card={card} documentUri="file:///ws/character/hana.card" vscodeApi={{ postMessage } as never} />)

    fireEvent.click(screen.getByRole("button", { name: "인터뷰 시작" }))
    await respond(postMessage, "interviews.start", { opening })
    await respond(postMessage, "interviews.next", { question })
    await screen.findByText("하나의 첫 반응은?")

    fireEvent.click(screen.getByRole("button", { name: "직접 쓰기" }))
    fireEvent.change(screen.getByPlaceholderText(/이 인물이라면/), { target: { value: "웃어 버린다" } })
    fireEvent.click(screen.getByRole("button", { name: "이렇게 한다" }))
    await respond(postMessage, "interviews.answer", {
      outcome: { isRebuilt: false, answeredCount: 1, classification: { valueId: "counter", valueLabel: "역공", isNewValue: false } }
    })

    expect(await screen.findByText(/「역공」로 읽었습니다/)).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/새 값의 이름/), { target: { value: "웃음으로 넘기기" } })
    fireEvent.click(screen.getByRole("button", { name: "새 값으로" }))

    const confirmRequest = postMessage.mock.calls.map((call) => call[0]).find((message) => message.method === "interviews.confirm")
    expect(confirmRequest.payload).toMatchObject({ questionId: "q1", confirmation: { kind: "newValue", id: "custom-3", label: "웃음으로 넘기기" } })
  })
})

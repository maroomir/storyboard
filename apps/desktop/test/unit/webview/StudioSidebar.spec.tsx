import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StudioSidebar } from "@webview/components/sidebar/StudioSidebar"
import type { StudioChatTurn, StudioInitialData, StudioTarget } from "@webview/lib/types"

const characterTarget: StudioTarget = {
  kind: "character",
  label: "seorin.card",
  entity: { kind: "character", key: "seorin" },
  cardUri: "file:///character/seorin.card",
  hasSelection: false
}

const draftTarget: StudioTarget = {
  kind: "draft",
  label: "01-intro.md",
  entity: { kind: "scene", key: "01-intro" },
  sceneUri: "file:///scene/01-intro.card",
  draftUri: "file:///draft/01-intro.md",
  hasSelection: false
}

const projectTarget: StudioTarget = {
  kind: "project",
  label: "story",
  entity: { kind: "project", key: "project" },
  hasSelection: false
}

const sceneCardTarget: StudioTarget = {
  kind: "scene",
  label: "01-intro.card",
  entity: { kind: "scene", key: "01-intro" },
  sceneUri: "file:///scene/01-intro.card",
  draftUri: "file:///draft/01-intro.md",
  hasSelection: false,
  draftExists: true
}

const proposalTurn: StudioChatTurn = {
  id: "p1",
  role: "assistant",
  kind: "proposal",
  summary: "과거사에 화재 사건 추가",
  targetFile: "character/seorin.card",
  patch: { target: "card", changes: [{ field: "description", value: ["화재를 겪었다"] }] },
  baselineHash: "hash-1",
  validation: { state: "pass", warnings: [] },
  status: "pending"
}

function renderStudio(
  target: StudioTarget,
  session?: StudioInitialData["session"]
): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn()
  vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
  render(<StudioSidebar initialData={{ title: "Studio", target, session }} />)
  return postMessage
}

function messagesByMethod(
  postMessage: ReturnType<typeof vi.fn>,
  method: string
): Array<Record<string, unknown>> {
  return postMessage.mock.calls
    .map((call) => call[0] as { method?: string })
    .filter((message) => message.method === method) as Array<Record<string, unknown>>
}

function respondTo(
  postMessage: ReturnType<typeof vi.fn>,
  method: string,
  payload: unknown
): void {
  const request = messagesByMethod(postMessage, method).at(-1) as { id: string }

  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "response", id: request.id, ok: true, payload }
    })
  )
}

function typeAndSend(text: string): void {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } })
  fireEvent.click(screen.getByLabelText("보내기"))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("StudioSidebar chat", () => {
  it("sends the instruction with the entity and the prior history", () => {
    const postMessage = renderStudio(characterTarget)

    typeAndSend("과거사 보강해줘")

    const sent = messagesByMethod(postMessage, "studio.chat.send").at(-1) as {
      payload: { entity: unknown; instruction: string; history: unknown[] }
    }

    expect(sent.payload.entity).toEqual({ kind: "character", key: "seorin" })
    expect(sent.payload.instruction).toBe("과거사 보강해줘")
    expect(sent.payload.history).toEqual([])
    expect(screen.getByText("과거사 보강해줘")).toBeTruthy()
  })

  it("shows a progress line with a cancel button while waiting", () => {
    const postMessage = renderStudio(characterTarget)

    typeAndSend("과거사 보강해줘")

    expect(screen.getByText("생각하는 중…")).toBeTruthy()

    fireEvent.click(screen.getByLabelText("중단"))

    expect(messagesByMethod(postMessage, "studio.chat.cancel")).toHaveLength(1)
    expect(screen.queryByText("생각하는 중…")).toBeNull()
  })

  it("follows the progress stage the host reports", async () => {
    renderStudio(characterTarget)
    typeAndSend("과거사 보강해줘")

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "event", method: "studio.chat.progress", payload: { stage: "looking-up" } }
      })
    )

    await waitFor(() => expect(screen.getByText("관련 자료를 찾는 중…")).toBeTruthy())
  })

  it("renders a free-form reply", async () => {
    const postMessage = renderStudio(characterTarget)
    typeAndSend("이 카드에 과거사가 있어?")

    respondTo(postMessage, "studio.chat.send", {
      turns: [{ id: "s1", role: "assistant", kind: "say", message: "아직 없습니다." }]
    })

    await waitFor(() => expect(screen.getByText("아직 없습니다.")).toBeTruthy())
  })

  it("answers a question by clicking one of its options", async () => {
    const postMessage = renderStudio(characterTarget)
    typeAndSend("보강해줘")

    respondTo(postMessage, "studio.chat.send", {
      turns: [
        {
          id: "a1",
          role: "assistant",
          kind: "ask",
          question: "어떤 축을 보강할까요?",
          options: ["성격", "과거사"]
        }
      ]
    })

    await waitFor(() => expect(screen.getByText("과거사")).toBeTruthy())
    fireEvent.click(screen.getByText("과거사"))

    const sent = messagesByMethod(postMessage, "studio.chat.send").at(-1) as {
      payload: { instruction: string; history: unknown[] }
    }

    expect(sent.payload.instruction).toBe("과거사")
    expect(sent.payload.history).toHaveLength(2)
  })

  it("shows a proposal with its validation badge and approves it", async () => {
    const postMessage = renderStudio(characterTarget)
    typeAndSend("과거사 보강해줘")
    respondTo(postMessage, "studio.chat.send", { turns: [proposalTurn] })

    await waitFor(() => expect(screen.getByText("과거사에 화재 사건 추가")).toBeTruthy())
    expect(screen.getByText("정합성 검사 통과")).toBeTruthy()
    expect(screen.getByText("카드 필드 1곳")).toBeTruthy()

    fireEvent.click(screen.getByText("승인"))

    const applied = messagesByMethod(postMessage, "studio.proposal.apply").at(-1) as {
      payload: { turn: { id: string } }
    }
    expect(applied.payload.turn.id).toBe("p1")

    respondTo(postMessage, "studio.proposal.apply", {
      status: "applied",
      message: "character/seorin.card 적용됨 · +12자"
    })

    await waitFor(() => expect(screen.getByText("적용됨")).toBeTruthy())
    expect(screen.getByText("character/seorin.card 적용됨 · +12자")).toBeTruthy()
  })

  it("surfaces a stale-baseline refusal on the proposal", async () => {
    const postMessage = renderStudio(characterTarget)
    typeAndSend("과거사 보강해줘")
    respondTo(postMessage, "studio.chat.send", { turns: [proposalTurn] })

    await waitFor(() => expect(screen.getByText("승인")).toBeTruthy())
    fireEvent.click(screen.getByText("승인"))

    respondTo(postMessage, "studio.proposal.apply", {
      status: "failed",
      message: "제안을 만든 뒤 파일이 바뀌어서 적용하지 않았어요. 다시 요청해 주세요."
    })

    await waitFor(() =>
      expect(
        screen.getByText("제안을 만든 뒤 파일이 바뀌어서 적용하지 않았어요. 다시 요청해 주세요.")
      ).toBeTruthy()
    )
  })

  it("shows conflict warnings but still allows approval", async () => {
    const postMessage = renderStudio(characterTarget)
    typeAndSend("과거사 보강해줘")

    respondTo(postMessage, "studio.chat.send", {
      turns: [
        {
          ...proposalTurn,
          validation: {
            state: "warn",
            warnings: [{ message: "씬 3과 어긋납니다", source: "scene/03.card" }]
          }
        }
      ]
    })

    await waitFor(() => expect(screen.getByText("기존 설정과 충돌할 수 있어요")).toBeTruthy())
    expect(screen.getByText("씬 3과 어긋납니다 (scene/03.card)")).toBeTruthy()
    expect(screen.getByText("승인")).toBeTruthy()
  })

  it("opens a diff without applying", async () => {
    const postMessage = renderStudio(characterTarget)
    typeAndSend("과거사 보강해줘")
    respondTo(postMessage, "studio.chat.send", { turns: [proposalTurn] })

    await waitFor(() => expect(screen.getByText("diff 보기")).toBeTruthy())
    fireEvent.click(screen.getByText("diff 보기"))

    expect(messagesByMethod(postMessage, "studio.proposal.preview")).toHaveLength(1)
    expect(messagesByMethod(postMessage, "studio.proposal.apply")).toHaveLength(0)
  })

  it("rejects a proposal locally without touching the host", async () => {
    const postMessage = renderStudio(characterTarget)
    typeAndSend("과거사 보강해줘")
    respondTo(postMessage, "studio.chat.send", { turns: [proposalTurn] })

    await waitFor(() => expect(screen.getByText("거절")).toBeTruthy())
    fireEvent.click(screen.getByText("거절"))

    await waitFor(() => expect(screen.getByText("거절함")).toBeTruthy())
    expect(messagesByMethod(postMessage, "studio.proposal.apply")).toHaveLength(0)
  })

  it("keeps the composer shut for a project target", () => {
    renderStudio(projectTarget)

    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true)
    expect(screen.getByPlaceholderText(/카드나 씬 파일을 먼저 열어/)).toBeTruthy()
  })

  it("names the draft as the edit target when the draft is open", () => {
    renderStudio(draftTarget)

    expect(screen.getByText("draft/01-intro.md")).toBeTruthy()
    expect(screen.getByPlaceholderText(/도입부를 더 긴장감 있게/)).toBeTruthy()
  })

  it("names the scene card as the edit target when the card is open", () => {
    renderStudio(sceneCardTarget)

    expect(screen.getByText("scene/01-intro.card")).toBeTruthy()
    expect(screen.getByPlaceholderText(/갈등을 더 선명하게/)).toBeTruthy()
  })

  it("names the card file as the edit target for a character", () => {
    renderStudio(characterTarget)

    expect(screen.getByText("character/seorin.card")).toBeTruthy()
  })
})

describe("StudioSidebar sessions", () => {
  it("restores the turns of the latest session", () => {
    renderStudio(characterTarget, {
      id: "11111111-1111-1111-1111-111111111111",
      entity: { kind: "character", key: "seorin" },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:05:00.000Z",
      title: "과거사 보강해줘",
      hasAppliedChanges: false,
      turns: [{ id: "u1", role: "user", text: "과거사 보강해줘" }]
    })

    expect(screen.getByText("과거사 보강해줘")).toBeTruthy()
  })

  it("saves the session with the entity and the applied flag", async () => {
    const postMessage = renderStudio(characterTarget)
    typeAndSend("과거사 보강해줘")
    respondTo(postMessage, "studio.chat.send", { turns: [proposalTurn] })

    await waitFor(() => expect(screen.getByText("승인")).toBeTruthy())
    fireEvent.click(screen.getByText("승인"))
    respondTo(postMessage, "studio.proposal.apply", { status: "applied", message: "적용됨" })

    await waitFor(() => {
      const saved = messagesByMethod(postMessage, "studio.session.save").at(-1) as {
        payload: { entity: unknown; hasAppliedChanges: boolean }
      }
      expect(saved.payload.entity).toEqual({ kind: "character", key: "seorin" })
      expect(saved.payload.hasAppliedChanges).toBe(true)
    })
  })

  it("lists the entity's sessions and opens one", async () => {
    const postMessage = renderStudio(characterTarget)

    fireEvent.click(screen.getByLabelText("대화 기록"))

    const listCall = messagesByMethod(postMessage, "studio.session.list").at(-1) as {
      payload: { entity: unknown }
    }
    expect(listCall.payload.entity).toEqual({ kind: "character", key: "seorin" })

    respondTo(postMessage, "studio.session.list", {
      sessions: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          title: "지난 대화",
          updatedAt: "2026-07-18T09:00:00.000Z",
          turnCount: 2,
          hasAppliedChanges: false
        }
      ]
    })

    await waitFor(() => expect(screen.getByText("지난 대화")).toBeTruthy())
    fireEvent.click(screen.getByText("지난 대화"))

    respondTo(postMessage, "studio.session.load", {
      session: {
        id: "22222222-2222-2222-2222-222222222222",
        entity: { kind: "character", key: "seorin" },
        createdAt: "2026-07-18T09:00:00.000Z",
        updatedAt: "2026-07-18T09:00:00.000Z",
        title: "지난 대화",
        hasAppliedChanges: false,
        turns: [{ id: "u9", role: "user", text: "지난 지시" }]
      }
    })

    await waitFor(() => expect(screen.getByText("지난 지시")).toBeTruthy())
  })

  it("starts a new session with a fresh id", async () => {
    const postMessage = renderStudio(characterTarget)

    typeAndSend("첫 지시")
    respondTo(postMessage, "studio.chat.send", {
      turns: [{ id: "s1", role: "assistant", kind: "say", message: "네" }]
    })
    await waitFor(() => expect(messagesByMethod(postMessage, "studio.session.save")).not.toHaveLength(0))
    const firstId = (
      messagesByMethod(postMessage, "studio.session.save").at(-1) as { payload: { id: string } }
    ).payload.id

    fireEvent.click(screen.getByLabelText("새 대화"))
    typeAndSend("두 번째 지시")

    await waitFor(() => {
      const secondId = (
        messagesByMethod(postMessage, "studio.session.save").at(-1) as { payload: { id: string } }
      ).payload.id
      expect(secondId).not.toBe(firstId)
    })
  })
})

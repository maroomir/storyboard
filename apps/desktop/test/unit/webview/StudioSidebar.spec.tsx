import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { StudioSidebar } from "@webview/components/sidebar/StudioSidebar"
import type { StudioInitialData, StudioTarget } from "@webview/lib/types"

const draftTarget: StudioTarget = {
  kind: "draft",
  label: "01-intro.md",
  entity: { kind: "scene", key: "01-intro" },
  sceneUri: "file:///scene/01-intro.txt",
  draftUri: "file:///draft/01-intro.md",
  hasSelection: false
}

function renderStudio(target: StudioTarget): ReturnType<typeof vi.fn> {
  const postMessage = vi.fn()
  vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))

  const initialData: StudioInitialData = { title: "Studio", target }
  render(<StudioSidebar initialData={initialData} />)
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

function runActionCalls(postMessage: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return messagesByMethod(postMessage, "studio.runAction")
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("StudioSidebar chat loop", () => {
  it("turns a typed instruction into an approvable proposal and runs it", async () => {
    const postMessage = renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "맞춤법 봐줘" } })
    fireEvent.click(screen.getByLabelText("보내기"))

    expect(screen.getByText("맞춤법 봐줘")).toBeTruthy()
    expect(screen.getByText("문법 검사")).toBeTruthy()

    fireEvent.click(screen.getByText("승인"))

    const calls = runActionCalls(postMessage)
    expect(calls).toHaveLength(1)
    const sent = calls[0] as { id: string; payload: { action: string } }
    expect(sent.payload.action).toBe("grammarCheck")
    expect(screen.getByText("실행 중…")).toBeTruthy()

    window.dispatchEvent(new MessageEvent("message", { data: { type: "response", id: sent.id, ok: true } }))

    await waitFor(() => expect(screen.getByText("완료")).toBeTruthy())
  })

  it("does not run when a proposal is cancelled", () => {
    const postMessage = renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "카드로 보충" } })
    fireEvent.click(screen.getByLabelText("보내기"))

    expect(screen.getByText("카드 기반 보충")).toBeTruthy()

    fireEvent.click(screen.getByText("취소"))

    expect(runActionCalls(postMessage)).toHaveLength(0)
    expect(screen.getByText("취소됨")).toBeTruthy()
  })

  it("forwards the typed instruction when editing a selection", () => {
    const postMessage = renderStudio({ ...draftTarget, hasSelection: true })

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "더 긴장감 있게 고쳐줘" } })
    fireEvent.keyDown(composer, { key: "Enter" })

    expect(screen.getByText("선택 영역 편집")).toBeTruthy()

    fireEvent.click(screen.getByText("승인"))

    const sent = runActionCalls(postMessage)[0] as { payload: { action: string; instruction: string } }
    expect(sent.payload.action).toBe("editSelection")
    expect(sent.payload.instruction).toBe("더 긴장감 있게 고쳐줘")
  })

  it("asks for a selection and offers chips when intent is unmet", () => {
    renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "짧게 줄여줘" } })
    fireEvent.click(screen.getByLabelText("보내기"))

    expect(screen.getByText(/영역을 먼저 선택/)).toBeTruthy()
    expect(screen.getByText("문법 검사")).toBeTruthy()
  })

  it("renders a proposal directly when a suggestion chip is picked", () => {
    renderStudio(draftTarget)

    fireEvent.click(screen.getByText("연속성 검사"))

    expect(screen.getByText("승인")).toBeTruthy()
  })

  it("reflects target changes from the host", async () => {
    renderStudio({ kind: "none", hasSelection: false })

    expect(screen.getByText(/Storyboard 프로젝트를 열면/)).toBeTruthy()

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "event", method: "studio.targetChanged", payload: draftTarget }
      })
    )

    await waitFor(() => expect(screen.getAllByText(/01-intro\.md/).length).toBeGreaterThan(0))
  })

  it("opens a slash menu, filters it, and inserts without submitting", () => {
    const postMessage = renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "/" } })
    expect(screen.getByRole("listbox")).toBeTruthy()

    fireEvent.change(composer, { target: { value: "/gr" } })
    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain("/grammar")

    fireEvent.keyDown(composer, { key: "ArrowDown" })
    fireEvent.keyDown(composer, { key: "Enter" })

    expect((composer as HTMLTextAreaElement).value).toBe("/grammar ")
    expect(runActionCalls(postMessage)).toHaveLength(0)
  })

  it("closes the slash menu on Escape", () => {
    renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "/gr" } })
    expect(screen.queryByRole("listbox")).toBeTruthy()

    fireEvent.keyDown(composer, { key: "Escape" })
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("runs a slash command directly without an approval step", async () => {
    const postMessage = renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "/grammar" } })
    fireEvent.click(screen.getByLabelText("보내기"))

    expect(screen.queryByText("승인")).toBeNull()
    expect(screen.getByText("실행 중…")).toBeTruthy()
    const calls = runActionCalls(postMessage)
    expect(calls).toHaveLength(1)
    const sent = calls[0] as { id: string; payload: { action: string } }
    expect(sent.payload.action).toBe("grammarCheck")

    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "response", id: sent.id, ok: true } })
    )
    await waitFor(() => expect(screen.getByText("완료")).toBeTruthy())
  })

  it("forwards the trailing instruction of a slash command", () => {
    const postMessage = renderStudio({ ...draftTarget, hasSelection: true })

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "/edit 더 밝게" } })
    fireEvent.click(screen.getByLabelText("보내기"))

    const sent = runActionCalls(postMessage)[0] as { payload: { action: string; instruction: string } }
    expect(sent.payload.action).toBe("editSelection")
    expect(sent.payload.instruction).toBe("더 밝게")
  })

  it("keeps a project target from the host instead of downgrading it", async () => {
    renderStudio({ kind: "none", hasSelection: false })

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "event",
          method: "studio.targetChanged",
          payload: { kind: "project", label: "내 소설", hasSelection: false }
        }
      })
    )

    await waitFor(() => expect(screen.getAllByText(/프로젝트/).length).toBeGreaterThan(0))
  })
})

describe("StudioSidebar stage", () => {
  function stageCalls(postMessage: ReturnType<typeof vi.fn>): Array<{ id: string }> {
    return messagesByMethod(postMessage, "studio.stage") as Array<{ id: string }>
  }

  function answerStage(id: string, stage: Record<string, unknown>): void {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "response", id, ok: true, payload: { stage } }
      })
    )
  }

  const sceneStage = {
    sceneStem: "01-intro",
    title: "첫 등교",
    draftLength: 1240,
    draftUpdatedAt: new Date().toISOString(),
    draftRevision: 2,
    review: "unreviewed",
    cards: [
      { kind: "character", name: "엘리아" },
      { kind: "background", name: "학교 옥상" }
    ]
  }

  it("asks the host for stage metadata once a scene is targeted", () => {
    const postMessage = renderStudio(draftTarget)

    expect(stageCalls(postMessage)).toHaveLength(1)
  })

  it("does not ask for stage metadata without a scene", () => {
    const postMessage = renderStudio({ kind: "none", hasSelection: false })

    expect(stageCalls(postMessage)).toHaveLength(0)
  })

  it("shows the scene, its facts, and its linked cards on the stage card", async () => {
    const postMessage = renderStudio(draftTarget)
    answerStage(stageCalls(postMessage)[0].id, sceneStage)

    await waitFor(() => expect(screen.getByText("씬 01 · 첫 등교")).toBeTruthy())
    expect(screen.getByText("1,240자 · 초안 v2 · 오늘 · 검수 전")).toBeTruthy()
    expect(screen.getByText("엘리아")).toBeTruthy()
    expect(screen.getByText("학교 옥상")).toBeTruthy()
  })

  it("recommends the next actions with a reason before any turn exists", () => {
    renderStudio(draftTarget)

    expect(screen.getByText("맞춤법과 어색한 문장을 진단으로 표시합니다.")).toBeTruthy()
  })

  it("refetches the stage after an action finishes", async () => {
    const postMessage = renderStudio(draftTarget)
    expect(stageCalls(postMessage)).toHaveLength(1)

    fireEvent.click(screen.getByText("문법 검사"))
    fireEvent.click(screen.getByText("승인"))
    const runId = (runActionCalls(postMessage)[0] as { id: string }).id

    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "response", id: runId, ok: true } })
    )

    await waitFor(() => expect(stageCalls(postMessage)).toHaveLength(2))
  })
})

describe("StudioSidebar session persistence", () => {
  function renderStudioWithSession(
    session: StudioInitialData["session"]
  ): ReturnType<typeof vi.fn> {
    const postMessage = vi.fn()
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
    render(<StudioSidebar initialData={{ title: "Studio", target: draftTarget, session }} />)
    return postMessage
  }

  it("restores turns and normalizes a running proposal to failed", () => {
    renderStudioWithSession({
      id: "11111111-1111-1111-1111-111111111111",
      entity: { kind: "scene", key: "01-intro" },
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:01:00.000Z",
      title: "맞춤법 봐줘",
      hasAppliedChanges: false,
      turns: [
        { id: "u1", role: "user", text: "맞춤법 봐줘" },
        { id: "a1", role: "assistant", kind: "proposal", action: "grammarCheck", status: "running" }
      ]
    })

    expect(screen.getByText("맞춤법 봐줘")).toBeTruthy()
    expect(screen.getByText(/중단됨/)).toBeTruthy()
  })

  it("saves the session after a proposal is run", () => {
    const postMessage = renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "/grammar" } })
    fireEvent.click(screen.getByLabelText("보내기"))

    const saved = messagesByMethod(postMessage, "studio.session.save").at(-1) as {
      payload: {
        id: string
        entity: unknown
        createdAt: string
        hasAppliedChanges: boolean
        turns: unknown[]
      }
    }
    expect(saved).toBeTruthy()
    expect(saved.payload.turns).toHaveLength(2)
    expect(typeof saved.payload.id).toBe("string")
    expect(saved.payload.entity).toEqual({ kind: "scene", key: "01-intro" })
    expect(saved.payload.hasAppliedChanges).toBe(false)
  })

  it("lists sessions from history and opens one", async () => {
    const postMessage = renderStudio(draftTarget)

    fireEvent.click(screen.getByLabelText("대화 기록"))

    const listCall = messagesByMethod(postMessage, "studio.session.list")[0] as {
      id: string
      payload: { entity: unknown }
    }
    expect(listCall).toBeTruthy()
    expect(listCall.payload.entity).toEqual({ kind: "scene", key: "01-intro" })

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "response",
          id: listCall.id,
          ok: true,
          payload: {
            sessions: [
              {
                id: "22222222-2222-2222-2222-222222222222",
                title: "지난 대화",
                updatedAt: "2026-07-18T09:00:00.000Z",
                turnCount: 2,
                hasAppliedChanges: false
              }
            ]
          }
        }
      })
    )

    await waitFor(() => expect(screen.getByText("지난 대화")).toBeTruthy())

    fireEvent.click(screen.getByText("지난 대화"))
    const loadCall = messagesByMethod(postMessage, "studio.session.load")[0] as {
      id: string
      payload: { id: string }
    }
    expect(loadCall.payload.id).toBe("22222222-2222-2222-2222-222222222222")

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "response",
          id: loadCall.id,
          ok: true,
          payload: {
            session: {
              id: "22222222-2222-2222-2222-222222222222",
              entity: { kind: "scene", key: "01-intro" },
              createdAt: "2026-07-18T09:00:00.000Z",
              updatedAt: "2026-07-18T09:00:00.000Z",
              title: "지난 대화",
              hasAppliedChanges: false,
              turns: [{ id: "u9", role: "user", text: "지난 지시" }]
            }
          }
        }
      })
    )

    await waitFor(() => expect(screen.getByText("지난 지시")).toBeTruthy())
  })

  it("starts a new session with a fresh id", () => {
    const postMessage = renderStudio(draftTarget)

    const composer = screen.getByPlaceholderText(/다시 생성/)
    fireEvent.change(composer, { target: { value: "/grammar" } })
    fireEvent.click(screen.getByLabelText("보내기"))
    const firstId = (
      messagesByMethod(postMessage, "studio.session.save").at(-1) as { payload: { id: string } }
    ).payload.id

    fireEvent.click(screen.getByLabelText("새 대화"))
    fireEvent.change(composer, { target: { value: "/grammar" } })
    fireEvent.click(screen.getByLabelText("보내기"))
    const secondId = (
      messagesByMethod(postMessage, "studio.session.save").at(-1) as { payload: { id: string } }
    ).payload.id

    expect(secondId).not.toBe(firstId)
  })
})

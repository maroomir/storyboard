import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CardViewer } from "@webview/components/card/CardViewer"
import type { CardViewerData } from "@webview/lib/types"

const data: CardViewerData = {
  documentUri: "file:///ws/character/hana.card/card.yaml",
  warnings: ["엔진 밖에서 바뀐 카드를 읽었습니다: character/hana.card"],
  view: {
    kind: "character",
    slug: "hana",
    name: "하나",
    facts: ["주연", "17세"],
    sections: [
      { id: "personality", label: "성격", lines: [{ text: "먼저 말을 건다." }] },
      { id: "voice", label: "말투", lines: [] },
      { id: "relations", label: "관계", lines: [{ text: "소꿉친구", label: "세라" }] }
    ]
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("CardViewer", () => {
  it("shows the card read-only, grouped by section, with the warnings it was read with", () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: vi.fn() }))
    render(<CardViewer initialData={data} />)

    expect(screen.getByRole("heading", { name: "하나" })).toBeTruthy()
    expect(screen.getByText("주연 · 17세")).toBeTruthy()
    expect(screen.getByText("읽기 전용 · 수정은 스튜디오에서")).toBeTruthy()
    expect(screen.getByRole("region", { name: "말투" }).textContent).toContain("아직 없음")
    expect(screen.getByRole("region", { name: "관계" }).textContent).toContain("세라")
    expect(screen.getByText(data.warnings[0] as string)).toBeTruthy()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("asks the host to open the text or the studio", () => {
    const postMessage = vi.fn()
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage }))
    render(<CardViewer initialData={data} />)

    fireEvent.click(screen.getByRole("button", { name: "텍스트로 열기" }))
    fireEvent.click(screen.getByRole("button", { name: "스튜디오에서 고치기" }))

    expect(postMessage.mock.calls.map((call) => (call[0] as { method: string }).method)).toEqual([
      "cards.openText",
      "cards.editInStudio"
    ])
  })

  it("names the file it could not read", () => {
    vi.stubGlobal("acquireVsCodeApi", () => ({ postMessage: vi.fn() }))
    render(
      <CardViewer
        initialData={{ documentUri: data.documentUri, warnings: [], error: "card.yaml 의 YAML 을 읽을 수 없습니다." }}
      />
    )

    expect(screen.getByText("card.yaml 의 YAML 을 읽을 수 없습니다.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "텍스트로 열기" })).toBeTruthy()
  })
})

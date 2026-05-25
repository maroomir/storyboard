import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ArcCurveView } from "@webview/components/character/ArcCurveView"

describe("ArcCurveView", () => {
  it("shows guidance when arc stages are empty", () => {
    render(<ArcCurveView arc={[]} />)

    expect(screen.getByText(/아크 단계가 없습니다/)).toBeTruthy()
  })

  it("renders timeline when arc stages exist", () => {
    render(
      <ArcCurveView
        arc={[
          { stage: "발단", summary: "시작", sceneRef: "01-prologue" },
          { stage: "절정", summary: "대립", sceneRef: "02-climax" }
        ]}
      />
    )

    expect(screen.getByLabelText("캐릭터 아크 타임라인")).toBeTruthy()
    expect(screen.getByText("발단")).toBeTruthy()
    expect(screen.getByText("절정")).toBeTruthy()
  })
})

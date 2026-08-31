import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CharacterRelationPreview } from "@webview/components/character/CharacterRelationPreview"

describe("CharacterRelationPreview", () => {
  it("shows guidance when relations are empty", () => {
    render(<CharacterRelationPreview characterName="엘리아" relations={[]} />)

    expect(screen.getByText(/관계가 없습니다/)).toBeTruthy()
  })

  it("renders character names from roster instead of ids", () => {
    render(
      <CharacterRelationPreview
        characterName="엘리아"
        characterRole="main"
        characterRoster={[
          { id: "elia", name: "엘리아", role: "main" },
          { id: "jihoon", name: "지훈", role: "supporting" }
        ]}
        relations={[{ target: "jihoon", type: "친구" }]}
      />
    )

    expect(screen.getByLabelText("엘리아 관계 미리보기")).toBeTruthy()
    expect(screen.getAllByText("엘리아").length).toBeGreaterThan(0)
    expect(screen.getByText("지훈")).toBeTruthy()
    expect(screen.queryByText("jihoon")).toBeNull()
    expect(screen.getByText("친구")).toBeTruthy()
  })

  it("shows target id as subtitle when character is not in roster", () => {
    render(
      <CharacterRelationPreview
        characterName="엘리아"
        relations={[{ target: "unknown-id", type: "라이벌" }]}
      />
    )

    expect(screen.getByText("unknown-id")).toBeTruthy()
    expect(screen.getByText("미등록")).toBeTruthy()
  })
})

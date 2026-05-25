import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CharacterRelationPreview } from "@webview/components/character/CharacterRelationPreview"

describe("CharacterRelationPreview", () => {
  it("shows guidance when relations are empty", () => {
    render(<CharacterRelationPreview characterId="elia" characterName="엘리아" relations={[]} />)

    expect(screen.getByText(/관계가 없습니다/)).toBeTruthy()
  })

  it("renders preview graph when relations exist", () => {
    render(
      <CharacterRelationPreview
        characterId="elia"
        characterName="엘리아"
        relations={[{ target: "jihoon", type: "친구" }]}
      />
    )

    expect(screen.getByLabelText("엘리아 관계 미리보기")).toBeTruthy()
    expect(screen.getByText("엘리아")).toBeTruthy()
    expect(screen.getByText("jihoon")).toBeTruthy()
    expect(screen.getByText("친구")).toBeTruthy()
  })
})

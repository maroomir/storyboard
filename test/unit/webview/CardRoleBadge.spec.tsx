import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { CardRoleBadge } from "@webview/components/card/CardRoleBadge"

describe("CardRoleBadge", () => {
  it("renders accessible labels for each role", () => {
    const { rerender } = render(<CardRoleBadge role="main" />)
    expect(screen.getByLabelText("주연")).toBeTruthy()

    rerender(<CardRoleBadge role="supporting" />)
    expect(screen.getByLabelText("조연")).toBeTruthy()

    rerender(<CardRoleBadge role="extra" />)
    expect(screen.getByLabelText("엑스트라")).toBeTruthy()
  })
})

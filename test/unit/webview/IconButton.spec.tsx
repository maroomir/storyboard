import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { IconButton } from "@webview/components/ui/IconButton"

describe("IconButton", () => {
  it("exposes add/remove actions via aria-label", () => {
    const onAdd = vi.fn()
    const onRemove = vi.fn()

    render(
      <>
        <IconButton icon="add" aria-label="추가" onClick={onAdd} />
        <IconButton icon="remove" aria-label="삭제" onClick={onRemove} />
      </>
    )

    screen.getByRole("button", { name: "추가" }).click()
    screen.getByRole("button", { name: "삭제" }).click()

    expect(onAdd).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
  })
})

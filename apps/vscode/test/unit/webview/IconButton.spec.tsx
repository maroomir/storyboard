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

  it("exposes yaml edit actions via aria-label", () => {
    const onEdit = vi.fn()
    const onSave = vi.fn()
    const onCancel = vi.fn()

    render(
      <>
        <IconButton icon="edit" aria-label="편집" onClick={onEdit} />
        <IconButton icon="save" aria-label="저장" onClick={onSave} />
        <IconButton icon="cancel" aria-label="취소" onClick={onCancel} />
      </>
    )

    screen.getByRole("button", { name: "편집" }).click()
    screen.getByRole("button", { name: "저장" }).click()
    screen.getByRole("button", { name: "취소" }).click()

    expect(onEdit).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

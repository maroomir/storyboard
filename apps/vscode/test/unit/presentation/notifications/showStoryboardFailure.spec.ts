import * as vscode from "vscode"
import { afterEach, describe, expect, it, vi } from "vitest"

import { missingProviderMessage } from "@storyboard/story-ai"

import { showStoryboardFailure } from "@/presentation/notifications/showStoryboardFailure"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("showStoryboardFailure", () => {
  it("offers to open settings when the failure is a missing API key and runs it on click", async () => {
    const errorMessage = vi
      .spyOn(vscode.window, "showErrorMessage")
      .mockResolvedValue("설정 열기" as never)
    const execute = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

    await showStoryboardFailure("초안 생성에 실패했습니다: OpenAI API 키가 설정되어 있지 않습니다.")

    expect(errorMessage).toHaveBeenCalledWith(expect.stringContaining("API 키"), "설정 열기")
    expect(execute).toHaveBeenCalledWith("storyboard.settings.open")
  })

  it("offers the provider picker when no provider is configured", async () => {
    vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue("제공자 선택" as never)
    const execute = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

    await showStoryboardFailure(`초안 생성에 실패했습니다: ${missingProviderMessage}`)

    expect(execute).toHaveBeenCalledWith("storyboard.provider.choose")
  })

  it("shows a plain toast for any other failure", async () => {
    const errorMessage = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined)
    const execute = vi.spyOn(vscode.commands, "executeCommand")

    await showStoryboardFailure("원고 조립에 실패했습니다: 알 수 없는 오류")

    expect(errorMessage).toHaveBeenCalledWith("원고 조립에 실패했습니다: 알 수 없는 오류")
    expect(execute).not.toHaveBeenCalled()
  })
})

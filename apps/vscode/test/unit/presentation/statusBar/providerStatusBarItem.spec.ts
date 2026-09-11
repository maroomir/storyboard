import { describe, expect, it } from "vitest"

import { ConfigBridge } from "@storyboard/story-ai"
import type { StoryboardConfigurationLike } from "@storyboard/story-ai"

import { describeProviderStatus, registerProviderStatusBarItem } from "@/presentation/statusBar/providerStatusBarItem"
import { createdStatusBarItems } from "../../../stubs/vscode"

function createConfiguration(values: Map<string, unknown>, workspaceKeys: readonly string[] = []): StoryboardConfigurationLike {
  return {
    get: <T>(section: string, defaultValue: T): T => (values.has(section) ? (values.get(section) as T) : defaultValue),
    inspect: <T>(section: string): { globalValue?: T; workspaceValue?: T } =>
      workspaceKeys.includes(section)
        ? { workspaceValue: values.get(section) as T }
        : { globalValue: values.get(section) as T | undefined }
  }
}

const configFiles = (): { user: string; workspace?: string } => ({
  user: "/home/me/.storyboard/config.json",
  workspace: "/work/novel/.storyboard/config.json"
})

describe("providerStatusBarItem", () => {
  it("names the default provider, its model, and where that choice came from", () => {
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike =>
        createConfiguration(new Map<string, unknown>([["defaultProvider", "claude"]]), ["defaultProvider"])
    })

    const status = describeProviderStatus({ configBridge, configFiles })

    expect(status.text).toBe("$(sparkle) claude · claude-sonnet-5")
    expect(status.tooltip).toContain("이 작품 설정 (/work/novel/.storyboard/config.json)")
  })

  it("asks the author to choose when no provider is configured", () => {
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => createConfiguration(new Map())
    })

    const status = describeProviderStatus({ configBridge, configFiles })

    expect(status.text).toBe("$(warning) AI 제공자 선택")
    expect(status.command).toBe("storyboard.provider.choose")
  })

  it("shows the item, opens settings on click, and refreshes when the configuration changes", () => {
    const values = new Map<string, unknown>([["defaultProvider", "openai"]])
    let notify: (() => void) | undefined
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => createConfiguration(values),
      onDidChangeConfiguration: (listener): { dispose: () => void } => {
        notify = (): void => listener({ affectsConfiguration: (): boolean => true })
        return { dispose: (): void => undefined }
      }
    })

    const disposable = registerProviderStatusBarItem({ configBridge, configFiles })
    const item = createdStatusBarItems.at(-1)

    expect(item?.isVisible).toBe(true)
    expect(item?.command).toBe("storyboard.settings.open")
    expect(item?.text).toBe("$(sparkle) openai · gpt-5.4-mini")

    values.delete("defaultProvider")
    notify?.()

    expect(item?.text).toBe("$(warning) AI 제공자 선택")
    expect(item?.command).toBe("storyboard.provider.choose")

    disposable.dispose()
    expect(item?.isVisible).toBe(false)
  })
})

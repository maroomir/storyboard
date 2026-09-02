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
        createConfiguration(new Map<string, unknown>([["defaultProvider", "claude-code"]]), ["defaultProvider"])
    })

    const status = describeProviderStatus({ configBridge, configFiles })

    expect(status.text).toBe("$(sparkle) claude-code · sonnet")
    expect(status.tooltip).toContain("이 작품 설정 (/work/novel/.storyboard/config.json)")
  })

  it("marks an unset provider as the default value", () => {
    const configBridge = new ConfigBridge({
      getConfiguration: (): StoryboardConfigurationLike => createConfiguration(new Map())
    })

    expect(describeProviderStatus({ configBridge, configFiles }).tooltip).toContain("출처: 기본값")
  })

  it("shows the item, opens settings on click, and refreshes when the configuration changes", () => {
    const values = new Map<string, unknown>([["defaultProvider", "codex"]])
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
    expect(item?.text).toBe("$(sparkle) codex · gpt-5.6-sol")

    values.set("defaultProvider", "mock")
    notify?.()

    expect(item?.text).toBe("$(sparkle) mock")

    disposable.dispose()
    expect(item?.isVisible).toBe(false)
  })
})

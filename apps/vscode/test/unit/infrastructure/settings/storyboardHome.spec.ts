import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createStoryboardHomeStores } from "@/infrastructure/settings/storyboardHome"

let home: string
let workspace: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "storyboard-home-"))
  workspace = mkdtempSync(join(tmpdir(), "storyboard-ws-"))
  vi.stubEnv("STORYBOARD_HOME", home)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

describe("createStoryboardHomeStores", () => {
  it("layers the workspace file over the home file and reports the origin", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ ai: { provider: { default: "openai" } }, editor: { draft: { keepHistory: true } } }))
    const stores = createStoryboardHomeStores({ workspaceRoot: workspace, onInvalidFile: () => undefined })

    expect(stores.configuration.get("ai.provider.default", "mock")).toBe("openai")
    expect(stores.configuration.inspect?.("editor.draft.keepHistory")).toEqual({ globalValue: true, workspaceValue: undefined })
    expect(stores.workspaceConfigFile).toBe(join(workspace, ".storyboard", "config.json"))

    stores.dispose()
  })

  // The panel refreshes from this event, so a write made in the panel must announce itself without
  // waiting for the file watcher.
  it("announces a change right after an update lands in the file", async () => {
    const stores = createStoryboardHomeStores({ workspaceRoot: workspace, onInvalidFile: () => undefined })
    const listener = vi.fn()
    stores.onDidChangeConfiguration(listener)

    await stores.configuration.update?.("ai.provider.default", "claude")

    expect(listener).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(join(home, "config.json"), "utf8"))).toEqual({ ai: { provider: { default: "claude" } } })
    expect(stores.configuration.get("ai.provider.default", "mock")).toBe("claude")

    stores.dispose()
  })

  it("reports an unparsable file and keeps serving defaults", () => {
    writeFileSync(join(home, "config.json"), "{ nope")
    const onInvalidFile = vi.fn()
    const stores = createStoryboardHomeStores({ workspaceRoot: undefined, onInvalidFile })

    expect(stores.configuration.get("ai.provider.default", "mock")).toBe("mock")
    expect(onInvalidFile).toHaveBeenCalledTimes(1)
    expect(onInvalidFile.mock.calls[0]?.[0]).toMatchObject({ code: "invalid-json" })

    stores.dispose()
  })
})

import { describe, expect, it } from "vitest"

import {
  formatChatIdList,
  parseBotConfigSnapshot,
  parseChatIdList
} from "@webview/components/settings/botSnapshot"

describe("parseChatIdList", () => {
  it("accepts comma or space separated ids, including negative group ids", () => {
    expect(parseChatIdList("123")).toEqual([123])
    expect(parseChatIdList("123, -100987")).toEqual([123, -100987])
    expect(parseChatIdList(" 1 2  3 ")).toEqual([1, 2, 3])
  })

  it("treats an empty field as clearing the list, not as an error", () => {
    expect(parseChatIdList("")).toEqual([])
    expect(parseChatIdList("  ")).toEqual([])
  })

  it("rejects anything that is not an exact integer", () => {
    expect(parseChatIdList("abc")).toBeUndefined()
    expect(parseChatIdList("1, x")).toBeUndefined()
    expect(parseChatIdList("1.5")).toBeUndefined()
  })

  it("round-trips through the display format", () => {
    expect(parseChatIdList(formatChatIdList([1, -2, 3]))).toEqual([1, -2, 3])
  })
})

describe("parseBotConfigSnapshot", () => {
  const valid = {
    configured: true,
    configFile: "/home/u/.storygram/config.json",
    tokenHint: "123:••••••",
    allowedChatIds: [1],
    allowedUserIds: [],
    workspacePath: "/novels/a",
    remote: null,
    defaultProvider: "claude-code",
    dashboardPort: 8787,
    workspaceCandidates: [],
    health: "online"
  }

  it("accepts a well-formed snapshot", () => {
    expect(parseBotConfigSnapshot(valid)?.health).toBe("online")
  })

  it("rejects payloads missing the fields the panel branches on", () => {
    expect(parseBotConfigSnapshot(undefined)).toBeUndefined()
    expect(parseBotConfigSnapshot({ ...valid, configured: "yes" })).toBeUndefined()
    expect(parseBotConfigSnapshot({ ...valid, workspaceCandidates: undefined })).toBeUndefined()
    expect(parseBotConfigSnapshot({ ...valid, health: 7 })).toBeUndefined()
  })
})

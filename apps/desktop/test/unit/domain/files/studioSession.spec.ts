import { describe, expect, it } from "vitest"

import {
  deriveStudioSessionTitle,
  parseStudioSession,
  selectSessionsToPrune,
  serializeStudioSession,
  type StudioSession
} from "@/domain/files/studioSession"
import type { StudioChatTurn } from "@/shared/messaging"

const turns: StudioChatTurn[] = [
  { id: "u1", role: "user", text: "맞춤법 봐줘" },
  { id: "a1", role: "assistant", kind: "proposal", action: "grammarCheck", status: "done" }
]

const session: StudioSession = {
  version: "1.0.0",
  id: "11111111-1111-1111-1111-111111111111",
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:05:00.000Z",
  title: "맞춤법 봐줘",
  turns
}

describe("studio session serialization", () => {
  it("round-trips through serialize and parse", () => {
    expect(parseStudioSession(serializeStudioSession(session))).toEqual(session)
  })

  it("rejects an unsupported version", () => {
    expect(() => parseStudioSession(JSON.stringify({ ...session, version: "9.9.9" }))).toThrow()
  })

  it("rejects an invalid turn", () => {
    const invalid = { ...session, turns: [{ id: "x", role: "assistant", kind: "proposal" }] }
    expect(() => parseStudioSession(JSON.stringify(invalid))).toThrow()
  })
})

describe("deriveStudioSessionTitle", () => {
  it("uses the first user turn text", () => {
    expect(deriveStudioSessionTitle(turns)).toBe("맞춤법 봐줘")
  })

  it("truncates long titles", () => {
    const longText = "가".repeat(60)
    const title = deriveStudioSessionTitle([{ id: "u", role: "user", text: longText }])
    expect(title).toBe(`${"가".repeat(40)}…`)
  })

  it("falls back when there is no user turn", () => {
    expect(deriveStudioSessionTitle([])).toBe("새 대화")
  })
})

describe("selectSessionsToPrune", () => {
  it("keeps the newest 20 by updatedAt", () => {
    const summaries = Array.from({ length: 25 }, (_, index) => ({
      id: `s-${index}`,
      updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
    }))

    const pruned = selectSessionsToPrune(summaries)

    expect(pruned).toHaveLength(5)
    expect(pruned).toContain("s-0")
    expect(pruned).not.toContain("s-24")
  })
})

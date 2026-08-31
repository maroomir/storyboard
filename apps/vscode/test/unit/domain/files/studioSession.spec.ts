import { describe, expect, it } from "vitest"

import {
  deriveStudioSessionTitle,
  parseStudioSession,
  selectSessionsToPrune,
  serializeStudioSession,
  type PrunableStudioSession,
  type StudioSession
} from "@storyboard/story-engine"
import type { StudioChatTurn } from "@storyboard/story-engine"

const turns: StudioChatTurn[] = [
  { id: "u1", role: "user", text: "맞춤법 봐줘" },
  { id: "a1", role: "assistant", kind: "say", message: "네, 확인해 볼게요." }
]

const session: StudioSession = {
  version: "2.0.0",
  id: "11111111-1111-1111-1111-111111111111",
  entity: { kind: "scene", key: "01-intro" },
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:05:00.000Z",
  title: "맞춤법 봐줘",
  hasAppliedChanges: false,
  turns
}

describe("studio session serialization", () => {
  it("round-trips through serialize and parse", () => {
    expect(parseStudioSession(serializeStudioSession(session))).toEqual(session)
  })

  it("rejects an unsupported version", () => {
    expect(() => parseStudioSession(JSON.stringify({ ...session, version: "9.9.9" }))).toThrow()
  })

  it("rejects a session without an entity", () => {
    expect(() => parseStudioSession(JSON.stringify({ ...session, entity: undefined }))).toThrow()
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
  function unappliedSessions(count: number): PrunableStudioSession[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `s-${index}`,
      updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      hasAppliedChanges: false
    }))
  }

  it("keeps the newest 10 unapplied sessions by updatedAt", () => {
    const pruned = selectSessionsToPrune(unappliedSessions(14))

    expect(pruned).toHaveLength(4)
    expect(pruned).toContain("s-0")
    expect(pruned).not.toContain("s-13")
  })

  it("never prunes a session whose proposal was applied", () => {
    const sessions: PrunableStudioSession[] = [
      ...unappliedSessions(12),
      {
        id: "applied",
        updatedAt: "2020-01-01T00:00:00.000Z",
        hasAppliedChanges: true
      }
    ]

    expect(selectSessionsToPrune(sessions)).not.toContain("applied")
  })

  it("does not count applied sessions against the keep budget", () => {
    const sessions: PrunableStudioSession[] = [
      ...unappliedSessions(10),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `applied-${index}`,
        updatedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
        hasAppliedChanges: true
      }))
    ]

    expect(selectSessionsToPrune(sessions)).toEqual([])
  })
})

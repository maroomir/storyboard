import { describe, expect, it } from "vitest"

import { storyStateFactLines } from '@storyboard/story-format';
import {
  createEmptyStoryState,
  formatStoryStateForPrompt,
  mergeStoryState,
  parseStoryState,
  readStoryState,
  serializeStoryState,
  writeStoryState,
  type StoryState,
  type StoryStateEntry
} from '@storyboard/story-format';
import { coerceStoryStateUpdate, StoryStateUpdatePrompt } from '@storyboard/story-ai';

class MemoryFileSystem {
  private content: string | undefined

  public constructor(initial?: string) {
    this.content = initial
  }

  public async readFile(): Promise<Uint8Array> {
    if (this.content === undefined) {
      throw new Error("File not found")
    }

    return new TextEncoder().encode(this.content)
  }

  public async writeFile(_uri: unknown, data: Uint8Array): Promise<void> {
    this.content = new TextDecoder().decode(data)
  }

  public read(): string | undefined {
    return this.content
  }
}

const sampleState: StoryState = {
  throughSceneOrder: 2,
  entries: [
    { section: "facts", text: "브로크만 정지하지 않았다" },
    { section: "relations", text: "이준→브로크: 존댓말" },
    { section: "revealed", text: "이준 — 브로크가 점검 시간을 기억한다" },
    { section: "motifs", text: '"오늘도… 손님이 오실 줄 알았습니다"' }
  ]
}

describe("storyState serialization", () => {
  it("round-trips a state through serialize and parse", () => {
    expect(parseStoryState(serializeStoryState(sampleState))).toEqual(sampleState)
  })

  it("records the through-scene marker", () => {
    expect(serializeStoryState(sampleState)).toContain("<!-- through-scene: 2 -->")
  })

  it("omits sections that have no entries", () => {
    const factsOnly: StoryState = { throughSceneOrder: 1, entries: [sampleState.entries[0]!] }

    const serialized = serializeStoryState(factsOnly)
    expect(serialized).toContain("## 확정 사실")
    expect(serialized).not.toContain("## 살아 있는 모티프")
  })

  it("parses an empty document as an empty state", () => {
    expect(parseStoryState("")).toEqual(createEmptyStoryState())
  })
})

describe("storyState file access", () => {
  it("reads back what it writes", async () => {
    const fileSystem = new MemoryFileSystem()

    await writeStoryState("/state.md", sampleState, fileSystem)

    expect(await readStoryState("/state.md", fileSystem)).toEqual(sampleState)
  })

  it("returns an empty state when the file is missing", async () => {
    expect(await readStoryState("/missing.md", new MemoryFileSystem())).toEqual(createEmptyStoryState())
  })
})

describe("mergeStoryState", () => {
  it("appends new entries and advances the through-scene order", () => {
    const additions: StoryStateEntry[] = [{ section: "facts", text: "이준이 경매에서 낙찰했다" }]

    const merged = mergeStoryState(sampleState, additions, 8)

    expect(merged.throughSceneOrder).toBe(8)
    expect(merged.entries).toContainEqual({ ...additions[0], throughScene: 8 })
    expect(merged.entries).toContainEqual(sampleState.entries[0])
  })

  it("drops duplicates and blank additions", () => {
    const merged = mergeStoryState(sampleState, [
      { section: "facts", text: "브로크만 정지하지 않았다" },
      { section: "facts", text: "   " }
    ], 3)

    expect(merged.entries).toHaveLength(sampleState.entries.length)
  })

  it("never lowers the through-scene order", () => {
    expect(mergeStoryState(sampleState, [], 1).throughSceneOrder).toBe(2)
  })

  it("caps each section to its most recent entries", () => {
    const additions: StoryStateEntry[] = Array.from({ length: 40 }, (_, index) => ({
      section: "facts" as const,
      text: `사실 ${index}`
    }))

    const merged = mergeStoryState(createEmptyStoryState(), additions, 5)

    expect(merged.entries).toHaveLength(24)
    expect(merged.entries.at(-1)?.text).toBe("사실 39")
  })
})

describe("formatStoryStateForPrompt", () => {
  it("renders labelled sections under the state header", () => {
    const prompt = formatStoryStateForPrompt(sampleState)

    expect(prompt).toContain("[이야기 상태]")
    expect(prompt).toContain("확정 사실:")
    expect(prompt).toContain("- 브로크만 정지하지 않았다")
    expect(prompt).toContain('- "오늘도… 손님이 오실 줄 알았습니다"')
  })

  it("returns undefined for an empty state", () => {
    expect(formatStoryStateForPrompt(createEmptyStoryState())).toBeUndefined()
  })
})

describe("coerceStoryStateUpdate", () => {
  it("maps each JSON section to its entries", () => {
    const items = coerceStoryStateUpdate(
      JSON.stringify({
        facts: ["사실1"],
        relations: ["관계1"],
        revealed: ["공개1"],
        motifs: ["모티프1"]
      })
    )

    expect(items).toEqual([
      { section: "facts", text: "사실1" },
      { section: "relations", text: "관계1" },
      { section: "revealed", text: "공개1" },
      { section: "motifs", text: "모티프1" }
    ])
  })

  it("ignores unknown keys, non-strings, and blanks", () => {
    const items = coerceStoryStateUpdate(
      JSON.stringify({ facts: ["사실1", 42, "  "], unknown: ["버림"] })
    )

    expect(items).toEqual([{ section: "facts", text: "사실1" }])
  })

  it("caps a section at five items", () => {
    const items = coerceStoryStateUpdate(
      JSON.stringify({ facts: Array.from({ length: 9 }, (_, i) => `사실${i}`) })
    )

    expect(items).toHaveLength(5)
  })

  it("returns nothing for unparsable text", () => {
    expect(coerceStoryStateUpdate("죄송합니다, 요약할 수 없습니다.")).toEqual([])
  })
})

describe("StoryStateUpdatePrompt", () => {
  it("includes the previous state and the draft body in the generic variant", () => {
    const prompt = StoryStateUpdatePrompt.build({
      sceneTitle: "02-scene-1-2",
      draftBody: "브로크가 망치를 놓았다.",
      previousState: "[이야기 상태]\n확정 사실:\n- 광장의 NPC가 멈췄다"
    })

    expect(prompt.user).toContain("[이전 상태]")
    expect(prompt.user).toContain("광장의 NPC가 멈췄다")
    expect(prompt.user).toContain("브로크가 망치를 놓았다.")
    expect(prompt.system).toContain("revealed")
  })

  it("omits the previous-state block when there is none", () => {
    const prompt = StoryStateUpdatePrompt.build({ sceneTitle: "01", draftBody: "본문" })

    expect(prompt.user).not.toContain("[이전 상태]")
  })

  it("keeps the xs system block shorter than generic", () => {
    const input = { sceneTitle: "01", draftBody: "본문" }

    expect(StoryStateUpdatePrompt.build(input, "xs").system.length).toBeLessThan(
      StoryStateUpdatePrompt.build(input, "generic").system.length
    )
  })
})

describe("storyState scene tagging", () => {
  const tagged: StoryState = {
    throughSceneOrder: 3,
    entries: [
      { section: "facts", text: "1화 사실", throughScene: 1 },
      { section: "facts", text: "3화 사실", throughScene: 3 },
      { section: "facts", text: "시점 없는 구버전 항목" }
    ]
  }

  it("round-trips the scene tag through serialize and parse", () => {
    expect(parseStoryState(serializeStoryState(tagged))).toEqual(tagged)
  })

  it("hides entries established at or after the scene being generated", () => {
    const prompt = formatStoryStateForPrompt(tagged, 3)

    expect(prompt).toContain("1화 사실")
    expect(prompt).toContain("시점 없는 구버전 항목")
    expect(prompt).not.toContain("3화 사실")
  })

  it("shows everything when no scene order is given", () => {
    expect(formatStoryStateForPrompt(tagged)).toContain("3화 사실")
  })

  it("returns undefined when every entry is from a later scene", () => {
    const laterOnly: StoryState = {
      throughSceneOrder: 5,
      entries: [{ section: "facts", text: "5화 사실", throughScene: 5 }]
    }

    expect(formatStoryStateForPrompt(laterOnly, 2)).toBeUndefined()
  })

  it("stamps merged additions with the scene order", () => {
    const merged = mergeStoryState(createEmptyStoryState(), [{ section: "facts", text: "새 사실" }], 7)

    expect(merged.entries[0]?.throughScene).toBe(7)
  })

  it("replaces the same scene's earlier entries when it is regenerated", () => {
    const merged = mergeStoryState(tagged, [{ section: "facts", text: "다시 만든 3화 사실" }], 3)

    expect(merged.entries.map((entry) => entry.text)).toEqual([
      "1화 사실",
      "시점 없는 구버전 항목",
      "다시 만든 3화 사실"
    ])
  })

  it("filters continuity fact lines by scene order too", () => {
    expect(storyStateFactLines(tagged, 3).join("\n")).not.toContain("3화 사실")
    expect(storyStateFactLines(tagged, 3).join("\n")).toContain("1화 사실")
  })
})

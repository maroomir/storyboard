import { describe, expect, it } from "vitest"

import {
  findForeignScriptSpans,
  findUnreadableStoryStateLines,
  hasForeignScript,
  stripForeignScript,
  storyStateFactLines,
  auditStoryState,
  createEmptyStoryState,
  formatSceneOrderRanges,
  formatStoryStateForPrompt,
  formatStoryStateStaleWarning,
  mergeStoryState,
  sealStoryState,
  parseStoryState,
  selectCharacterKnowledge,
  readStoryState,
  serializeStoryState,
  storyStateSceneOrders,
  writeStoryState,
  type StoryState,
  type StoryStateEntry,
  coerceStoryStateUpdate,
} from '@storyboard/story-model';
import { StoryStateUpdatePrompt } from '@storyboard/story-ai';

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

const inputHash = `sha256:${"a".repeat(64)}`
const otherInputHash = `sha256:${"b".repeat(64)}`

const sampleState: StoryState = {
  throughSceneOrder: 2,
  sceneInputHashes: new Map(),
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
    const factsOnly: StoryState = {
      throughSceneOrder: 1,
      sceneInputHashes: new Map(),
      entries: [sampleState.entries[0]!]
    }

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

    const merged = mergeStoryState(sampleState, additions, 8, inputHash)

    expect(merged.throughSceneOrder).toBe(8)
    expect(merged.entries).toContainEqual({ ...additions[0], throughScene: 8 })
    expect(merged.entries).toContainEqual(sampleState.entries[0])
  })

  it("drops duplicates and blank additions", () => {
    const merged = mergeStoryState(sampleState, [
      { section: "facts", text: "브로크만 정지하지 않았다" },
      { section: "facts", text: "   " }
    ], 3, inputHash)

    expect(merged.entries).toHaveLength(sampleState.entries.length)
  })

  it("never lowers the through-scene order", () => {
    expect(mergeStoryState(sampleState, [], 1, inputHash).throughSceneOrder).toBe(2)
  })

  // 원장은 작품의 기억이므로 버리지 않는다. 프롬프트 예산은 주입 시점에 맞춘다.
  it("keeps every entry instead of evicting the oldest", () => {
    const additions: StoryStateEntry[] = Array.from({ length: 40 }, (_, index) => ({
      section: "facts" as const,
      text: `사실 ${index}`
    }))

    const merged = mergeStoryState(createEmptyStoryState(), additions, 5, inputHash)

    expect(merged.entries).toHaveLength(40)
    expect(merged.entries[0]?.text).toBe("사실 0")
    expect(merged.entries.at(-1)?.text).toBe("사실 39")
  })
})

describe("story state injection budget", () => {
  // 실제 원장처럼 항목마다 다른 고유명사를 담는다. 낱말이 전부 같으면 관련도가 평평해져
  // 최근 항목만 남는다.
  const subjects = Array.from({ length: 40 }, (_, index) => `대상${index}호`)

  function fortyFacts(): StoryState {
    return mergeStoryState(
      createEmptyStoryState(),
      subjects.map((subject) => ({
        section: "facts" as const,
        text: `${subject}가 봉인되었다`
      })),
      5,
      inputHash
    )
  }

  it("caps the injected entries per section", () => {
    const lines = formatStoryStateForPrompt(fortyFacts())?.split("\n") ?? []

    expect(lines.filter((line) => line.startsWith("- "))).toHaveLength(24)
  })

  it("falls back to the most recent entries when there is no scene text", () => {
    const prompt = formatStoryStateForPrompt(fortyFacts())

    expect(prompt).toContain("대상39호가 봉인되었다")
    expect(prompt).not.toContain("대상0호가 봉인되었다")
  })

  // 1막에서 심은 사실이 3막 씬에 그 이름이 나오면 되살아나야 복선을 회수할 수 있다.
  it("revives an old entry that the scene text mentions", () => {
    const prompt = formatStoryStateForPrompt(fortyFacts(), undefined, "대상0호를 다시 꺼낸다")

    expect(prompt).toContain("대상0호가 봉인되었다")
  })

  it("keeps the injected entries in the order they were established", () => {
    const prompt = formatStoryStateForPrompt(fortyFacts(), undefined, "대상0호와 대상39호")
    const lines = (prompt ?? "").split("\n").filter((line) => line.startsWith("- "))

    expect(lines.indexOf("- 대상0호가 봉인되었다")).toBeLessThan(
      lines.indexOf("- 대상39호가 봉인되었다")
    )
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

describe("selectCharacterKnowledge", () => {
  it("gives a character the facts and reveals it witnessed, before this scene, plus untagged ones", () => {
    const state = parseStoryState(
      [
        "# 이야기 상태",
        "## 확정 사실",
        "- [1|hana] 하나만 본 일",
        "- [1|jun] 준만 본 일",
        "- [1] 태그 없는 옛 항목",
        "- [3|hana] 뒤 씬의 일",
        "## 공개된 정보",
        "- [2|hana,jun] 둘이 들은 일",
        "## 살아 있는 모티프",
        "- [1|hana] 모티프는 지식이 아니다",
        ""
      ].join("\n")
    )

    expect(selectCharacterKnowledge(state, "hana", 3)).toEqual(["하나만 본 일", "태그 없는 옛 항목", "둘이 들은 일"])
    expect(selectCharacterKnowledge(state, "jun", 3)).toEqual(["준만 본 일", "태그 없는 옛 항목", "둘이 들은 일"])
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

  it("reads witness-tagged facts and revealed items", () => {
    const items = coerceStoryStateUpdate(
      JSON.stringify({
        facts: [{ text: "하나가 편지를 읽었다", witnesses: ["하나", " ", 3] }, { text: "" }, "태그 없는 사실"],
        revealed: [{ witnesses: ["준"] }]
      })
    )

    expect(items).toEqual([
      { section: "facts", text: "하나가 편지를 읽었다", witnesses: ["하나"] },
      { section: "facts", text: "태그 없는 사실" }
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

  it("drops an entry contaminated with another writing system", () => {
    const items = coerceStoryStateUpdate(
      JSON.stringify({ facts: ["브로크가 기억한다", "이준은 чуж чуж?", "채린이 전화했다"] })
    )

    expect(items.map((item) => item.text)).toEqual(["브로크가 기억한다", "채린이 전화했다"])
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
    sceneInputHashes: new Map(),
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
      sceneInputHashes: new Map(),
      entries: [{ section: "facts", text: "5화 사실", throughScene: 5 }]
    }

    expect(formatStoryStateForPrompt(laterOnly, 2)).toBeUndefined()
  })

  it("stamps merged additions with the scene order", () => {
    const merged = mergeStoryState(createEmptyStoryState(), [{ section: "facts", text: "새 사실" }], 7, inputHash)

    expect(merged.entries[0]?.throughScene).toBe(7)
  })

  it("replaces the same scene's earlier entries when it is regenerated", () => {
    const merged = mergeStoryState(tagged, [{ section: "facts", text: "다시 만든 3화 사실" }], 3, inputHash)

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

describe("foreign script detection", () => {
  it("locates a contaminated run with its surrounding excerpt", () => {
    const spans = findForeignScriptSpans("지금은 다음 ضرب을 정하지 못한 채 멈춰 있었다.")

    expect(spans).toHaveLength(1)
    expect(spans[0]?.text).toBe("ضرب")
    expect(spans[0]?.excerpt).toContain("정하지 못한 채")
  })

  it("finds nothing in clean Korean prose with Latin and Han characters", () => {
    const clean = "이준은 BROK-07 각인을 보았다. 漢字도 섞여 있었다."

    expect(findForeignScriptSpans(clean)).toEqual([])
    expect(hasForeignScript(clean)).toBe(false)
  })

  it("reports every contaminated run in order", () => {
    const spans = findForeignScriptSpans("첫 чуж 그리고 두 번째 সত্য 끝")

    expect(spans.map((span) => span.text)).toEqual(["чуж", "সত্য"])
  })
})

describe("stripForeignScript", () => {
  it("removes a contaminated run so it cannot seed the next scene", () => {
    expect(stripForeignScript("다음 ضربم을 정하지 못했다.")).toBe("다음 을 정하지 못했다.")
  })

  it("leaves clean Korean, Latin and Han text untouched", () => {
    const clean = "이준은 BROK-07 각인과 漢字를 보았다."

    expect(stripForeignScript(clean)).toBe(clean)
  })
})

describe("story state invalidation", () => {
  function ledgerThrough(order: number, hash = inputHash): StoryState {
    let state = createEmptyStoryState()

    for (let scene = 1; scene <= order; scene += 1) {
      state = mergeStoryState(state, [{ section: "facts", text: `${scene}화 사실` }], scene, hash)
    }

    return state
  }

  function currentHashes(orders: readonly number[], hash = inputHash): Map<number, string> {
    return new Map(orders.map((order) => [order, hash]))
  }

  it("round-trips the scene input hashes and the stale marker", () => {
    const state = ledgerThrough(2)
    const rewound = mergeStoryState(state, [{ section: "facts", text: "다시 만든 1화" }], 1, otherInputHash)

    const serialized = serializeStoryState(rewound)
    expect(serialized).toContain(`<!-- scene-input: 1 ${otherInputHash} -->`)
    expect(serialized).toContain("- [2!] 2화 사실")
    expect(parseStoryState(serialized)).toEqual(rewound)
  })

  // 되감기: 21을 다시 만들면 22~32는 폐기된 판본을 전제로 뽑힌 항목이다.
  it("marks later scenes stale when an earlier scene is regenerated", () => {
    const rewound = mergeStoryState(ledgerThrough(5), [{ section: "facts", text: "새 3화" }], 3, inputHash)

    expect(rewound.entries.filter((entry) => entry.isStale === true).map((entry) => entry.text)).toEqual([
      "4화 사실",
      "5화 사실"
    ])
    expect(rewound.entries.find((entry) => entry.text === "2화 사실")?.isStale).toBeUndefined()
  })

  it("keeps stale entries out of the prompt but leaves them in the file", () => {
    const rewound = mergeStoryState(ledgerThrough(5), [{ section: "facts", text: "새 3화" }], 3, inputHash)

    const prompt = formatStoryStateForPrompt(rewound)
    expect(prompt).toContain("2화 사실")
    expect(prompt).not.toContain("4화 사실")
    expect(serializeStoryState(rewound)).toContain("4화 사실")
  })

  it("clears the stale mark when the scene itself is regenerated", () => {
    const rewound = mergeStoryState(ledgerThrough(5), [{ section: "facts", text: "새 3화" }], 3, inputHash)
    const repaired = mergeStoryState(rewound, [{ section: "facts", text: "새 4화" }], 4, inputHash)

    expect(repaired.entries.find((entry) => entry.text === "새 4화")?.isStale).toBeUndefined()
    expect(repaired.entries.filter((entry) => entry.isStale === true).map((entry) => entry.text)).toEqual([
      "5화 사실"
    ])
  })

  // 입력 해시: 카드나 씬을 고쳐 놓고 그 씬을 다시 만들지 않은 경우.
  it("marks a scene stale when its current input hash differs", () => {
    const audit = auditStoryState(ledgerThrough(3), new Map([[1, inputHash], [2, otherInputHash], [3, inputHash]]))

    expect(audit.staleSceneOrders).toEqual([2])
    expect(audit.staleEntryCount).toBe(1)
    expect(formatStoryStateForPrompt(audit.state)).not.toContain("2화 사실")
  })

  it("marks a scene stale when its scene file is gone", () => {
    const audit = auditStoryState(ledgerThrough(3), currentHashes([1, 3]))

    expect(audit.staleSceneOrders).toEqual([2])
  })

  it("reports nothing when every recorded hash still matches", () => {
    const audit = auditStoryState(ledgerThrough(3), currentHashes([1, 2, 3]))

    expect(audit.staleSceneOrders).toEqual([])
    expect(audit.unsealedSceneOrders).toEqual([])
    expect(formatStoryStateStaleWarning(audit)).toBeUndefined()
  })

  it("carries a rewound scene into the audit report", () => {
    const rewound = mergeStoryState(ledgerThrough(5), [{ section: "facts", text: "새 3화" }], 3, inputHash)

    const audit = auditStoryState(rewound, currentHashes([1, 2, 3, 4, 5]))

    expect(audit.staleSceneOrders).toEqual([4, 5])
    expect(formatStoryStateStaleWarning(audit)).toContain("씬 4~5")
  })

  // 0.8 이전 원장에는 해시가 없다. 대조할 근거가 없다고 사실을 버리지는 않는다.
  it("treats an unsealed scene as valid and reports it for sealing", () => {
    const legacy = parseStoryState("# 이야기 상태\n<!-- through-scene: 2 -->\n## 확정 사실\n- [1] 옛 사실\n- [2] 옛 사실 2\n")

    const audit = auditStoryState(legacy, currentHashes([1, 2], otherInputHash))

    expect(audit.staleSceneOrders).toEqual([])
    expect(audit.unsealedSceneOrders).toEqual([1, 2])
    expect(formatStoryStateForPrompt(audit.state)).toContain("옛 사실")
  })

  it("seals only the scenes that have no recorded hash", () => {
    const legacy = parseStoryState("# 이야기 상태\n<!-- through-scene: 2 -->\n<!-- scene-input: 1 " + inputHash + " -->\n## 확정 사실\n- [1] 옛 사실\n- [2] 옛 사실 2\n")

    const sealed = sealStoryState(legacy, currentHashes([1, 2], otherInputHash))

    expect(sealed.sceneInputHashes.get(1)).toBe(inputHash)
    expect(sealed.sceneInputHashes.get(2)).toBe(otherInputHash)
    expect(auditStoryState(sealed, currentHashes([1, 2], otherInputHash)).staleSceneOrders).toEqual([1])
  })

  it("lists the scene orders a ledger carries", () => {
    expect(storyStateSceneOrders(ledgerThrough(3))).toEqual([1, 2, 3])
  })

  it("compacts scene orders into contiguous ranges", () => {
    expect(formatSceneOrderRanges([22, 23, 24, 27, 30, 31])).toBe("22~24, 27, 30~31")
    expect(formatSceneOrderRanges([5])).toBe("5")
  })
})

describe("story state witnesses", () => {
  const witnessedState: StoryState = {
    throughSceneOrder: 3,
    sceneInputHashes: new Map(),
    entries: [
      { section: "facts", text: "하나가 등불을 껐다", throughScene: 1, witnesses: ["hana"] },
      { section: "facts", text: "준이 다리에서 기다렸다", throughScene: 2, witnesses: ["jun"] },
      { section: "facts", text: "둘이 시장에서 마주쳤다", throughScene: 2, witnesses: ["hana", "jun"] },
      { section: "facts", text: "목격자 없는 구 버전 항목", throughScene: 2 }
    ]
  }

  it("round-trips witnesses through serialize and parse", () => {
    expect(parseStoryState(serializeStoryState(witnessedState))).toEqual(witnessedState)
  })

  it("writes the witness list beside the scene number", () => {
    expect(serializeStoryState(witnessedState)).toContain("- [1|hana] 하나가 등불을 껐다")
  })

  it("still reads an entry tagged with a scene number but no witnesses", () => {
    const parsed = parseStoryState("# 이야기 상태\n<!-- through-scene: 2 -->\n## 확정 사실\n- [1] 옛 항목\n")

    expect(parsed.entries).toEqual([{ section: "facts", text: "옛 항목", throughScene: 1 }])
  })

  it("hides facts the focal character did not witness", () => {
    const prompt = formatStoryStateForPrompt(witnessedState, 4, undefined, { focal: "hana" })

    expect(prompt).toContain("하나가 등불을 껐다")
    expect(prompt).toContain("둘이 시장에서 마주쳤다")
    expect(prompt).not.toContain("준이 다리에서 기다렸다")
  })

  it("keeps entries with no recorded witnesses, which cannot be judged", () => {
    const prompt = formatStoryStateForPrompt(witnessedState, 4, undefined, { focal: "hana" })

    expect(prompt).toContain("목격자 없는 구 버전 항목")
  })

  it("keeps every entry when no focal character is given", () => {
    const prompt = formatStoryStateForPrompt(witnessedState, 4)

    expect(prompt).toContain("준이 다리에서 기다렸다")
  })

  it("carries witnesses through a merge", () => {
    const merged = mergeStoryState(createEmptyStoryState(), [{ section: "facts", text: "새 사실", witnesses: ["hana"] }], 5)

    expect(merged.entries).toEqual([
      { section: "facts", text: "새 사실", throughScene: 5, witnesses: ["hana"] }
    ])
  })
})

describe("findUnreadableStoryStateLines", () => {
  function ledgerWith(...lines: readonly string[]): string {
    return ["# 이야기 상태", "<!-- through-scene: 3 -->", "## 확정 사실", ...lines, ""].join("\n")
  }

  it("says nothing about lines it can read", () => {
    expect(
      findUnreadableStoryStateLines(
        ledgerWith("- 태그 없는 사실", "- [2] 사실", "- [2!] 사실", "- [2|hana] 사실", "- [2!|hana,jun] 사실")
      )
    ).toEqual([])
  })

  it("reports a bracket prefix that is not a scene tag", () => {
    expect(findUnreadableStoryStateLines(ledgerWith("- [삼] 사실"))).toEqual(["[삼] 사실"])
    expect(findUnreadableStoryStateLines(ledgerWith("- [2!!] 사실"))).toEqual(["[2!!] 사실"])
    expect(findUnreadableStoryStateLines(ledgerWith("- [] 사실"))).toEqual(["[] 사실"])
  })

  it("ignores bullets outside a known section", () => {
    const stray = ["# 이야기 상태", "## 알 수 없는 절", "- [삼] 사실", ""].join("\n")

    expect(findUnreadableStoryStateLines(stray)).toEqual([])
  })

  it("looks at every section, not just the first", () => {
    const twoSections = [
      "# 이야기 상태",
      "## 확정 사실",
      "- [2] 사실",
      "## 공개된 정보",
      "- [abc] 공개",
      ""
    ].join("\n")

    expect(findUnreadableStoryStateLines(twoSections)).toEqual(["[abc] 공개"])
  })
})


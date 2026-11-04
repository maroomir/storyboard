import { describe, expect, it } from "vitest"

import type { CharacterCard } from "@storyboard/story-model"
import {
  addBeatNote,
  assembleActedSkeleton,
  actorKnowledge,
  beatRetryReasons,
  countCatchphrase,
  findBeatCatchphraseOveruse,
  findOverlongLines,
  liveBeatNotes,
  observablePassage,
  planActedBeats,
  witnessedPassages
} from "@storyboard/story-engine"

const manjae: CharacterCard = { type: "character", id: "jo-man-jae", name: "조만재", role: "main", aliases: ["만재"] }
const eunha: CharacterCard = { type: "character", id: "jung-eun-ha", name: "정은하", role: "main" }

describe("planActedBeats", () => {
  it("names the cast from ids and aliases, opens a break where the place changes, and gives a castless beat to everyone", () => {
    const beats = planActedBeats(
      [
        { text: "만재가 백과사전을 집는다", cast: ["jo-man-jae"], place: "거실", time: "아침 6시" },
        { text: "은하가 벨을 누른다", cast: ["만재", "jung-eun-ha", "unknown"], place: "거실", time: "아침 6시 10분" },
        { text: "둘이 마주 선다", cast: ["jung-eun-ha"], place: "현관", time: "아침 6시 11분" },
        "모두 아침을 먹는다"
      ],
      [manjae, eunha]
    )

    expect(beats.map((beat) => beat.cast)).toEqual([["조만재"], ["조만재", "정은하"], ["정은하"], ["조만재", "정은하"]])
    expect(beats.map((beat) => beat.isBreak)).toEqual([false, false, true, false])
    expect(beats[3]).toMatchObject({ number: 4, text: "모두 아침을 먹는다" })
  })
})

describe("witnessedPassages", () => {
  const beats = planActedBeats(
    [
      { text: "a", cast: ["jo-man-jae"], place: "거실" },
      { text: "b", cast: ["jo-man-jae", "jung-eun-ha"], place: "거실" },
      { text: "c", cast: ["jung-eun-ha"], place: "거실" }
    ],
    [manjae, eunha]
  )
  const passages = new Map([
    [1, "나는 사전을 폈다.\n(속) 오늘도 평화롭다."],
    [2, "벨이 울렸다.\n(속) 왔구나."]
  ])

  it("shows a character only the beats it was in, without the focal character's inner lines", () => {
    expect(witnessedPassages(beats, passages, "정은하")).toBe("[대목 2]\n벨이 울렸다.")
    expect(witnessedPassages(beats, passages, "조만재")).toBe(
      "[대목 1]\n나는 사전을 폈다.\n\n[대목 2]\n벨이 울렸다."
    )
    expect(observablePassage("(속) 밉상이다.\n“왔어?”")).toBe("“왔어?”")
  })
})

describe("catchphrase counting per beat", () => {
  it("counts at word boundaries only", () => {
    expect(countCatchphrase("이 몸이 간다. 윗사람이 몸소 왔다.", "이 몸")).toBe(1)
    expect(countCatchphrase("이 몸이 간다. 그래, 이 몸.", "이 몸")).toBe(2)
  })

  it("exempts a catchphrase the beat text itself quotes", () => {
    const catchphrases = new Map([["조만재", ["세기의 철학자", "이 몸"]]])
    const [plain] = planActedBeats([{ text: "만재가 허세를 부린다", cast: ["jo-man-jae"] }], [manjae])
    const [quoting] = planActedBeats(
      [{ text: '만재가 "세기의 철학자"를 두 번 외친다', cast: ["jo-man-jae"] }],
      [manjae]
    )
    const passage = "“세기의 철학자가 왔다.” “세기의 철학자는 여자를 돌같이 본다.”"

    expect(findBeatCatchphraseOveruse({ beat: plain!, passage, catchphrases, limit: 1 })).toHaveLength(1)
    expect(findBeatCatchphraseOveruse({ beat: quoting!, passage, catchphrases, limit: 1 })).toEqual([])
  })
})

describe("findOverlongLines", () => {
  it("flags a line over the character cap or over the sentence cap", () => {
    const proposal = {
      inner: "",
      options: [
        { strategy: "a", action: "", lines: ["짧다.", "하나. 둘. 셋."] },
        { strategy: "b", action: "", lines: ["가".repeat(81)] }
      ]
    }

    expect(findOverlongLines(proposal, 80, 2)).toEqual([
      '선택지 1: "하나. 둘. 셋." (9자)',
      `선택지 2: "${"가".repeat(81)}" (81자)`
    ])
  })
})

describe("beat notes", () => {
  it("drops notes that carry dialogue, dedupes, keeps the last three, and lets them expire after two beats", () => {
    let notes = addBeatNote([], 1, "같은 비유 되풀이")
    notes = addBeatNote(notes, 1, '"엘리트"라고 부르기')
    notes = addBeatNote(notes, 2, "같은 비유 되풀이")
    notes = addBeatNote(notes, 2, "연설하기")
    notes = addBeatNote(notes, 3, "먼저 말하기")
    notes = addBeatNote(notes, 3, "웃어넘기기")

    expect(notes.map((note) => note.text)).toEqual(["연설하기", "먼저 말하기", "웃어넘기기"])
    expect(liveBeatNotes(notes, 4)).toEqual(["연설하기", "먼저 말하기", "웃어넘기기"])
    expect(liveBeatNotes(notes, 5)).toEqual(["먼저 말하기", "웃어넘기기"])
  })
})

describe("actorKnowledge", () => {
  it("keeps to the ledger's witnessed lines when the ledger has any", () => {
    const ledgerKnowledge = new Map([["조만재", ["은하가 이사를 왔다"]], ["정은하", []]])

    expect(actorKnowledge({ name: "정은하", ledgerKnowledge, previousContext: "앞 장면" })).toEqual([])
    expect(actorKnowledge({ name: "조만재", ledgerKnowledge, previousContext: "앞 장면" })).toEqual(["은하가 이사를 왔다"])
  })

  it("falls back to the previous context when the ledger gives nobody anything", () => {
    expect(actorKnowledge({ name: "조만재", ledgerKnowledge: undefined, previousContext: " 한서라는 이름을 썼다 " })).toEqual([
      "앞 장면까지의 줄거리(누가 무엇을 봤는지는 기록이 없다): 한서라는 이름을 썼다"
    ])
    expect(actorKnowledge({ name: "조만재", ledgerKnowledge: new Map(), previousContext: undefined })).toEqual([])
  })
})

describe("beatRetryReasons", () => {
  it("collects low scores with their avoid line, a missed beat, early material and the catchphrase count", () => {
    expect(
      beatRetryReasons({
        verdict: {
          scores: [
            { name: "조만재", score: 2, reason: "모르는 사실", avoid: "먼저 말하기" },
            { name: "정은하", score: 4, reason: "", avoid: "" }
          ],
          isBeatCovered: false,
          beatMissing: "벨을 누르지 않음",
          earlyMaterial: "당근 맛 비유",
          repeats: ""
        },
        catchphraseOveruse: ["입버릇 2회"]
      })
    ).toEqual([
      "조만재: 모르는 사실 → 피할 것: 먼저 말하기",
      "지시 누락: 벨을 누르지 않음",
      "다음 대목 소재를 미리 씀: 당근 맛 비유",
      "입버릇 2회"
    ])
    expect(beatRetryReasons({ verdict: undefined, catchphraseOveruse: [] })).toEqual([])
  })

  it("sends a passage back when the judge found it repeating the previous one", () => {
    expect(
      beatRetryReasons({
        verdict: {
          scores: [{ name: "조만재", score: 4, reason: "", avoid: "" }],
          isBeatCovered: true,
          beatMissing: "",
          earlyMaterial: "",
          repeats: "창밖을 본다"
        },
        catchphraseOveruse: []
      })
    ).toEqual(["직전 대목을 되풀이함: 창밖을 본다"])
  })
})

describe("assembleActedSkeleton", () => {
  it("opens the scene and every break with a coordinate marker", () => {
    const beats = planActedBeats(
      [
        { text: "a", cast: ["jo-man-jae"], place: "거실", time: "아침" },
        { text: "b", cast: ["jo-man-jae", "jung-eun-ha"], place: "거실", time: "아침" },
        { text: "c", cast: ["jung-eun-ha"], place: "현관", time: "낮" }
      ],
      [manjae, eunha]
    )

    expect(assembleActedSkeleton(beats, new Map([[1, "하나"], [2, "둘"], [3, "셋"]]))).toBe(
      [
        "⟪시각: 아침 / 장소: 거실 / 있는 사람: 조만재⟫",
        "하나",
        "둘",
        "---",
        "⟪시각: 낮 / 장소: 현관 / 있는 사람: 정은하⟫",
        "셋"
      ].join("\n\n")
    )
  })
})

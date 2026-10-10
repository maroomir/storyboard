import { describe, expect, it } from "vitest"

import type { SceneBeat } from '@storyboard/story-model';
import {
  applyPlannedSceneBreaks,
  countMissingSegmentMarkers,
  countSceneBreakLines,
  ensureLeadingMarker,
  findThinDialogueBeats,
  findThinExpansionSpots,
  isTimeJump,
  planSceneBreaks,
  planSkeletonCalls,
  renderPlannedNarrative,
  restoreSceneBreaks
} from "@storyboard/story-engine"

const name = (ref: string): string => ref

function beat(place: string, time: string, extra: Partial<Exclude<SceneBeat, string>> = {}): SceneBeat {
  return { text: `${place}에서 ${time}에 일어난 일`, place, time, ...extra }
}

// 하루를 따라가는 42비트 카드와 같은 모양: 집 안에서 방을 옮겨 다니고, 학교·공원·옥상으로 나간다.
const dayBeats: SceneBeat[] = [
  beat("집 거실, 발코니 앞", "아침 6시, 등교 전"),
  beat("집 거실, 발코니 앞 가림막", "아침 6시 10분"),
  beat("형제 방", "아침 6시 반"),
  beat("집 식탁", "아침 7시, 아침 식사"),
  beat("집 식탁", "아침 7시 10분"),
  beat("학교", "오전부터 오후까지, 경과"),
  beat("학교 교문 앞", "오후 4시, 방과 후"),
  beat("귀갓길과 집 복도", "오후 4시 15분"),
  beat("집 현관", "오후 4시 20분"),
  beat("집 현관과 거실", "오후 4시 20분, 직후"),
  beat("욕실과 거실", "오후 4시 반"),
  beat("집 거실", "오후 5시"),
  beat("집 부엌과 거실", "오후 5시 반"),
  beat("집 거실과 형 방", "오후 6시"),
  beat("형 방과 현관", "오후 6시 20분"),
  beat("동네 공원 농구 코트", "해 질 녘, 오후 6시 반"),
  beat("동네 공원 농구 코트", "오후 7시"),
  beat("동네 공원 농구 코트", "오후 7시 반"),
  beat("집 거실", "저녁 8시"),
  beat("집 현관과 거실", "저녁 8시 반"),
  beat("집 거실", "저녁 8시 45분"),
  beat("옥상 발코니", "밤 9시"),
  beat("옥상 발코니", "밤 9시 반"),
  beat("옥상 발코니", "밤 10시"),
  beat("옥상 발코니", "밤 10시 반")
]

describe("isTimeJump", () => {
  it("does not break a few minutes later", () => {
    expect(isTimeJump("아침 6시", "아침 6시 10분", 60)).toBe(false)
    expect(isTimeJump("오후 5시 45분", "저녁 6시", 60)).toBe(false)
  })

  it("breaks an hour or more later", () => {
    expect(isTimeJump("오후 4시", "오후 5시", 60)).toBe(true)
    expect(isTimeJump("15:20", "17:00", 60)).toBe(true)
  })

  it("compares day periods when no clock time is given", () => {
    expect(isTimeJump("아침", "방과 후", 60)).toBe(true)
    expect(isTimeJump("오전부터 오후까지", "오후 4시, 방과 후", 60)).toBe(false)
  })

  it("always breaks on the next day", () => {
    expect(isTimeJump("밤 10시", "다음 날 밤 10시", 60)).toBe(true)
  })
})

describe("planSceneBreaks", () => {
  it("cuts a day into settings, not into rooms", () => {
    const plan = planSceneBreaks(dayBeats, name, 60)

    expect(plan?.segments.map((segment) => segment.beats)).toEqual([
      [0, 1],
      [2],
      [3, 4],
      [5, 6],
      [7, 8, 9, 10, 11, 12, 13, 14],
      [15, 16, 17],
      [18, 19, 20],
      [21, 22, 23, 24]
    ])
  })

  it("lets the author force or forbid a break", () => {
    const beats: SceneBeat[] = [
      beat("집 거실", "저녁 8시"),
      beat("옥상", "저녁 8시 5분", { break: false }),
      beat("옥상", "저녁 8시 10분", { break: true })
    ]

    expect(planSceneBreaks(beats, name, 60)?.segments.map((segment) => segment.beats)).toEqual([[0, 1], [2]])
  })

  it("leaves a scene of plain string beats to the model", () => {
    expect(planSceneBreaks(["아침을 먹는다", "학교에 간다"], name, 60)).toBeUndefined()
  })

  it("describes each segment by its cast, places and time span", () => {
    const plan = planSceneBreaks(
      [
        { text: "a", cast: ["hana"], place: "집 현관", time: "오후 4시" },
        { text: "b", cast: ["hana", "jun"], place: "집 거실", time: "오후 4시 20분" }
      ],
      (ref) => (ref === "hana" ? "하나" : "준"),
      60
    )

    expect(plan?.segments[0]?.coordinate).toBe(
      "출연: 하나, 준 / 장소: 집 현관 → 집 거실 / 시각: 오후 4시 ~ 오후 4시 20분"
    )
  })

  it("marks every segment in the narrative the skeleton reads", () => {
    const beats = [beat("집", "아침"), beat("학교", "오후")]
    const plan = planSceneBreaks(beats, name, 60)
    const narrative = renderPlannedNarrative(beats, plan!, name)

    expect(narrative.startsWith("⟪대목 1⟫\n")).toBe(true)
    expect(narrative).toContain("\n\n⟪대목 2⟫\n학교에서")
  })

  it("renders only the asked segments, numbered as in the whole scene", () => {
    const beats = [beat("집", "아침"), beat("학교", "오후"), beat("공원", "저녁")]
    const plan = planSceneBreaks(beats, name, 60)!

    const narrative = renderPlannedNarrative(beats, plan, name, [1, 2])

    expect(narrative.startsWith("⟪대목 2⟫\n학교에서")).toBe(true)
    expect(narrative).toContain("\n\n⟪대목 3⟫\n공원에서")
    expect(narrative).not.toContain("⟪대목 1⟫")
  })

  it("adds no marker to the rest of a segment another call began", () => {
    const beats = [beat("집", "아침"), beat("집", "아침 6시 10분"), beat("학교", "오후")]
    const plan = planSceneBreaks(beats, name, 60)!

    expect(renderPlannedNarrative(beats, plan, name, [1]).startsWith("집에서 아침 6시 10분에")).toBe(true)
  })
})

describe("planSkeletonCalls", () => {
  const plan = planSceneBreaks(dayBeats, name, 60)!

  it("bundles consecutive segments until a call's share of the target would pass the cap", () => {
    // 25비트·목표 10,000자 → 비트당 400자. 대목 비트 수 [2,1,2,2,8,3,3,4].
    expect(planSkeletonCalls(plan, 10_000, 3_200).map((call) => call.markers)).toEqual([[1, 2, 3, 4], [5], [6, 7], [8]])
    expect(planSkeletonCalls(plan, 10_000, 3_200).map((call) => call.beats.length)).toEqual([7, 8, 6, 4])
  })

  it("splits a segment larger than the cap into even runs of beats that carry no marker", () => {
    const calls = planSkeletonCalls(plan, 10_000, 1_400)
    const fifth = calls.filter((call) => call.beats.every((beat) => beat >= 7 && beat <= 14))

    expect(fifth.map((call) => call.beats)).toEqual([[7, 8, 9], [10, 11, 12], [13, 14]])
    expect(fifth.map((call) => call.markers)).toEqual([[5], [], []])
    expect(calls.flatMap((call) => call.beats)).toEqual(Array.from({ length: 25 }, (_, index) => index))
  })

  it("makes one call when the cap covers the scene or there is no target", () => {
    expect(planSkeletonCalls(plan, 10_000, 10_000)).toEqual([
      { beats: Array.from({ length: 25 }, (_, index) => index), markers: [1, 2, 3, 4, 5, 6, 7, 8] }
    ])
    expect(planSkeletonCalls(plan, undefined, 1_000)).toHaveLength(1)
  })
})

describe("segment markers of one call", () => {
  it("prepends the call's first marker when the model dropped it", () => {
    expect(ensureLeadingMarker("교문을 나섰다.", 2)).toBe("⟪대목 2⟫\n교문을 나섰다.")
    expect(ensureLeadingMarker("⟪대목 2⟫\n교문을 나섰다.", 2)).toBe("⟪대목 2⟫\n교문을 나섰다.")
  })

  it("counts only the asked markers as missing", () => {
    expect(countMissingSegmentMarkers("⟪대목 2⟫\n교문.", [2, 3])).toBe(1)
    expect(countMissingSegmentMarkers("⟪대목 2⟫\n교문.", [1])).toBe(1)
    expect(countMissingSegmentMarkers("⟪대목 1⟫ 밥. ⟪대목 2⟫ 교문.", [1, 2])).toBe(0)
  })
})

describe("applyPlannedSceneBreaks", () => {
  const plan = planSceneBreaks([beat("집", "아침"), beat("학교", "오후"), beat("공원", "저녁")], name, 60)!

  it("keeps breaks only before the markers", () => {
    const skeleton = ["⟪대목 1⟫", "밥을 먹었다.", "---", "양치를 했다.", "", "---", "⟪대목 2⟫", "수업을 들었다.", "", "⟪대목 3⟫ 공원에 갔다."].join("\n")

    const applied = applyPlannedSceneBreaks(skeleton, plan)

    expect(applied.text).toBe(["밥을 먹었다.", "양치를 했다.", "", "---", "", "수업을 들었다.", "", "---", "", "공원에 갔다."].join("\n"))
    expect(applied.coordinates).toEqual(["장소: 집 / 시각: 아침", "장소: 학교 / 시각: 오후", "장소: 공원 / 시각: 저녁"])
    expect(applied.missingMarkers).toBe(0)
  })

  it("joins a segment whose marker was dropped to the one before", () => {
    const applied = applyPlannedSceneBreaks(["⟪대목 1⟫", "밥.", "⟪대목 3⟫", "공원."].join("\n"), plan)

    expect(countSceneBreakLines(applied.text)).toBe(1)
    expect(applied.coordinates).toEqual(["장소: 집 / 시각: 아침", "장소: 공원 / 시각: 저녁"])
    expect(applied.missingMarkers).toBe(1)
  })

  it("reports a skeleton that copied no marker at all", () => {
    expect(applyPlannedSceneBreaks("밥.\n\n---\n\n공원.", plan).hasNoMarkers).toBe(true)
  })
})

describe("restoreSceneBreaks", () => {
  const section = ["엄마가 밥을 차렸다.", "", "---", "", "교문 앞에 은하가 서 있었다.", "", "“늦었네.”"].join("\n")

  it("puts a dropped break back before the paragraph that opens the next segment", () => {
    const expanded = [
      "엄마가 밥을 차렸다. 김이 올랐다.",
      "",
      "수업은 평소처럼 흘렀다. 교문 앞에 은하가 서 있었다.",
      "",
      "“늦었네.” 은하가 말했다."
    ].join("\n")

    const restored = restoreSceneBreaks(section, expanded)

    expect(restored).toBe(
      ["엄마가 밥을 차렸다. 김이 올랐다.", "---", "수업은 평소처럼 흘렀다. 교문 앞에 은하가 서 있었다.", "“늦었네.” 은하가 말했다."].join("\n\n")
    )
  })

  it("removes a break the expansion added and keeps the skeleton's", () => {
    const expanded = ["엄마가 밥을 차렸다.", "---", "김이 올랐다.", "교문 앞에 은하가 서 있었다.", "“늦었네.”"].join("\n\n")

    expect(countSceneBreakLines(restoreSceneBreaks(section, expanded) ?? "")).toBe(1)
  })

  it("keeps a trailing break of the section", () => {
    expect(restoreSceneBreaks("밥을 먹었다.\n\n---", "밥을 맛있게 먹었다.")).toBe("밥을 맛있게 먹었다.\n\n---")
  })

  it("gives up when no paragraph resembles the next segment", () => {
    expect(restoreSceneBreaks(section, "전혀 다른 이야기.")).toBeUndefined()
  })
})

describe("findThinDialogueBeats", () => {
  const beats: SceneBeat[] = [
    { text: "형과 첫 설전을 벌인다", cast: ["a", "b"], place: "거실", time: "저녁 8시" },
    { text: "망고를 두고 다툰다", cast: ["a", "b"], place: "거실", time: "저녁 8시 10분" },
    { text: "혼자 옥상에 오른다", cast: ["a"], place: "옥상", time: "밤 9시" }
  ]
  const plan = planSceneBreaks(beats, name, 60)!

  it("names the conversational beats of a segment with too few lines", () => {
    const skeleton = ["⟪대목 1⟫", "\u201c왔어?\u201d", "\u201c응.\u201d", "", "⟪대목 2⟫", "옥상에 올랐다."].join("\n")

    expect(findThinDialogueBeats(skeleton, plan, beats, 3)).toEqual(["형과 첫 설전을 벌인다", "망고를 두고 다툰다"])
  })

  it("leaves a segment with enough lines alone", () => {
    const lines = Array.from({ length: 6 }, (_, index) => `\u201c말 ${index}\u201d`)
    const skeleton = ["⟪대목 1⟫", ...lines, "⟪대목 2⟫", "옥상."].join("\n")

    expect(findThinDialogueBeats(skeleton, plan, beats, 3)).toEqual([])
  })
})

describe("findThinExpansionSpots", () => {
  it("picks the dialogue after which the expansion added the least", () => {
    const section = "\u201c하나다.\u201d\n\u201c둘이다.\u201d\n\u201c셋이다.\u201d"
    const expanded =
      "\u201c하나다.\u201d 그 말에 나는 한참을 생각했다. 왜 하필 지금인가.\n\u201c둘이다.\u201d\n\u201c셋이다.\u201d"

    expect(findThinExpansionSpots(section, expanded, 2).map((spot) => spot.line)).toEqual(["둘이다.", "하나다."])
  })
})

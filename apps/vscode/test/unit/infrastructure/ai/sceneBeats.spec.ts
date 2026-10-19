import { describe, expect, it } from "vitest"

import { SceneBeatsPrompt } from '@storyboard/story-ai';
import { coerceExpandedSceneBeats } from '@storyboard/story-model';

describe("SceneBeatsPrompt", () => {
  const base = {
    sceneBody: "[목적]\n진아가 방송실에서 엽서를 발견한다",
    grounding: ["[이 장면의 확정 사실]", "- 장소: 방송실"],
    characterNames: ["서진아", "이도현"],
    beatCount: 6
  }

  it("asks for exactly the requested number of beats and passes card material", () => {
    const artifact = SceneBeatsPrompt.build(base)

    expect(artifact.system).toContain("정확히 6개")
    expect(artifact.system).toContain("[이 장면의 종료 지점]")
    expect(artifact.user).toContain("서진아, 이도현")
    expect(artifact.user).toContain("- 장소: 방송실")
    expect(artifact.user).toContain("[씬 카드]\n[목적]")
    expect(artifact.user).not.toContain("[창작자 요약]")
  })

  it("asks for a cast, place and time on every beat", () => {
    const artifact = SceneBeatsPrompt.build(base)

    expect(artifact.system).toContain("비트마다 좌표를 달아라")
    expect(artifact.system).toContain('[{"text":"…","cast":["이름"],"place":"…","time":"…"}')
    expect(SceneBeatsPrompt.build(base, "xs").system).toContain("cast")
  })

  it("confines beats to the author summary when one exists", () => {
    const artifact = SceneBeatsPrompt.build({ ...base, summary: "진아가 엽서를 읽고 도현을 떠올린다.\n" })

    expect(artifact.system).toContain("[창작자 요약]에 적힌 사건만")
    expect(artifact.system).not.toContain("요약이 없으므로")
    expect(artifact.user).toContain("[창작자 요약]\n진아가 엽서를 읽고 도현을 떠올린다.")
  })

  it("lets beats be developed from structure fields when there is no summary", () => {
    const artifact = SceneBeatsPrompt.build({ ...base, summary: "  " })

    expect(artifact.system).toContain("요약이 없으므로")
    expect(artifact.user).not.toContain("[창작자 요약]")
  })
})

describe("mock scene beats", () => {
  it("returns a JSON string array so the beats step works with the mock provider", async () => {
    const { MockAiProvider } = await import('@storyboard/story-ai')
    const response = await new MockAiProvider().generate({
      taskName: "sceneBeats",
      messages: [{ role: "user", content: "[씬 카드]\n[목적]\n진아가 엽서를 발견한다" }]
    })

    expect(JSON.parse(response.text)).toEqual(["모의 비트 하나", "모의 비트 둘", "모의 비트 셋"])
  })
})

describe("coerceExpandedSceneBeats", () => {
  it("reads object beats with their coordinates and keeps string beats as text only", () => {
    expect(
      coerceExpandedSceneBeats(
        '[{"text":" 문을 연다 ","cast":[" 진아 ", 3, ""],"place":" 방송실 ","time":""}, "둘째", {"cast":["x"]}, {"text":"  "}]'
      )
    ).toEqual([
      { text: "문을 연다", cast: ["진아"], place: "방송실" },
      { text: "둘째", cast: [] }
    ])
  })

  it("returns nothing for a response that is not an array", () => {
    expect(coerceExpandedSceneBeats("비트를 못 뽑겠다")).toEqual([])
  })
})

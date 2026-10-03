import { describe, expect, it } from "vitest"

import {
  computeDraftBodyHash,
  parseSceneDialogue,
  serializeSceneDialogue,
  type SceneDialogueRecord
} from "@storyboard/story-model"
import { coerceDialogueAttribution } from "@storyboard/story-ai"
import { selectRepresentativeDialogue } from "@storyboard/story-pipeline"

function recordOf(sceneStem: string, turns: SceneDialogueRecord["turns"]): SceneDialogueRecord {
  return { sceneStem, bodyHash: computeDraftBodyHash(sceneStem), turns }
}

describe("scene dialogue codec", () => {
  it("serializes and parses a dialogue record", () => {
    const record = recordOf("01-scene-1-1", [
      { index: 1, speaker: "kailen", text: "문 잠그십시오." },
      { index: 2, speaker: "unknown", text: "누가 왔다." }
    ])

    expect(parseSceneDialogue(serializeSceneDialogue(record))).toEqual(record)
  })

  it("changes the body hash when the draft body changes", () => {
    expect(computeDraftBodyHash("초안 본문")).not.toBe(computeDraftBodyHash("초안 본문 "))
  })

  it("rejects a record whose hash is not a sha256 digest", () => {
    const broken = JSON.stringify({ sceneStem: "01-a", bodyHash: "nope", turns: [] })

    expect(() => parseSceneDialogue(broken)).toThrow()
  })
})

describe("dialogue attribution coercion", () => {
  const known = ["kailen", "oldo"]

  it("fills every turn even when the model answers for only some", () => {
    const attributions = coerceDialogueAttribution('[{"index": 2, "speaker": "oldo"}]', 3, known)

    expect(attributions).toEqual([
      { index: 1, speaker: "unknown" },
      { index: 2, speaker: "oldo" },
      { index: 3, speaker: "unknown" }
    ])
  })

  it("falls back to unknown for a speaker outside the roster", () => {
    const attributions = coerceDialogueAttribution('[{"index": 1, "speaker": "balzac"}]', 1, known)

    expect(attributions).toEqual([{ index: 1, speaker: "unknown" }])
  })

  it("drops an index beyond the turn count", () => {
    const raw = '[{"index": 1, "speaker": "kailen"}, {"index": 9, "speaker": "oldo"}]'

    expect(coerceDialogueAttribution(raw, 1, known)).toEqual([{ index: 1, speaker: "kailen" }])
  })

  it("returns all unknown when the response is not parseable", () => {
    expect(coerceDialogueAttribution("판별할 수 없습니다", 2, known)).toEqual([
      { index: 1, speaker: "unknown" },
      { index: 2, speaker: "unknown" }
    ])
  })
})

describe("representative dialogue selection", () => {
  const corpus: SceneDialogueRecord[] = [
    recordOf("01-scene-1-1", [
      { index: 1, speaker: "kailen", text: "이 물건은 값보다 내력이 먼저입니다." },
      { index: 2, speaker: "kailen", text: "네." },
      { index: 3, speaker: "oldo", text: "의뢰인의 배후가 심상치 않다는 말이다." }
    ]),
    recordOf("02-scene-1-2", [
      { index: 1, speaker: "kailen", text: "봉인 매듭이 마탑식입니다." },
      { index: 2, speaker: "unknown", text: "누군가 문을 두드렸다고 합니다." }
    ]),
    recordOf("03-scene-1-3", [
      { index: 1, speaker: "kailen", text: "밤에 다시 열어 보겠습니다." },
      { index: 2, speaker: "kailen", text: "그 자리는 비워 두십시오." }
    ])
  ]

  it("collects only the requested speaker in scene order", () => {
    expect(selectRepresentativeDialogue(corpus, "oldo", "04-scene-1-4")).toEqual([
      "의뢰인의 배후가 심상치 않다는 말이다."
    ])
  })

  it("excludes scenes that come after the one being generated", () => {
    const samples = selectRepresentativeDialogue(corpus, "kailen", "02-scene-1-2")

    expect(samples).toEqual(["이 물건은 값보다 내력이 먼저입니다."])
    expect(samples).not.toContain("봉인 매듭이 마탑식입니다.")
    expect(samples).not.toContain("밤에 다시 열어 보겠습니다.")
  })

  it("drops lines that are too short to carry a voice", () => {
    expect(selectRepresentativeDialogue(corpus, "kailen", "04-scene-1-4")).not.toContain("네.")
  })

  it("excludes the scene being generated", () => {
    const samples = selectRepresentativeDialogue(corpus, "kailen", "03-scene-1-3")

    expect(samples).not.toContain("밤에 다시 열어 보겠습니다.")
    expect(samples).not.toContain("그 자리는 비워 두십시오.")
  })

  it("is deterministic and honours the limit while spreading across scenes", () => {
    const first = selectRepresentativeDialogue(corpus, "kailen", "04-scene-1-4", 2)
    const second = selectRepresentativeDialogue(corpus, "kailen", "04-scene-1-4", 2)

    expect(first).toEqual(second)
    expect(first).toHaveLength(2)
    expect(first[0]).toBe("이 물건은 값보다 내력이 먼저입니다.")
    expect(first[1]).toBe("밤에 다시 열어 보겠습니다.")
  })

  it("returns nothing when the corpus has no line for the character", () => {
    expect(selectRepresentativeDialogue([], "kailen", "01-scene-1-1")).toEqual([])
  })
})

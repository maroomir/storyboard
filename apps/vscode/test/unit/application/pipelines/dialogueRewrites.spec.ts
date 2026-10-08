import { describe, expect, it } from "vitest"

import {
  mergeDialogueRewrites,
  numberSkeletonDialogue,
  resolveSceneGenerationTuning
} from "@storyboard/story-engine"

const tuning = resolveSceneGenerationTuning(undefined)
const skeleton = "하나가 말했다. “가자, 지금.” 준이 웃었다. “싫은데.” 하나가 돌아섰다."

describe("numberSkeletonDialogue", () => {
  it("tags every quoted line in order and remembers where it was", () => {
    const numbered = numberSkeletonDialogue(skeleton, tuning)

    expect(numbered.text).toBe("하나가 말했다. ⟨1⟩“가자, 지금.” 준이 웃었다. ⟨2⟩“싫은데.” 하나가 돌아섰다.")
    expect(numbered.dialogues.map((dialogue) => dialogue.text)).toEqual(["가자, 지금.", "싫은데."])
  })
})

describe("mergeDialogueRewrites", () => {
  const numbered = numberSkeletonDialogue(skeleton, tuning)

  it("replaces a line one character claims and strips the quotes it may have sent", () => {
    const merged = mergeDialogueRewrites(
      skeleton,
      numbered,
      new Map([["준", [{ index: 2, text: "“뭐 별거는 아닌데, 싫은데.”" }]]])
    )

    expect(merged.text).toBe("하나가 말했다. “가자, 지금.” 준이 웃었다. “뭐 별거는 아닌데, 싫은데.” 하나가 돌아섰다.")
    expect(merged.replacedCount).toBe(1)
    expect(merged.contestedIndices).toEqual([])
  })

  it("keeps the skeleton line when two characters claim it", () => {
    const merged = mergeDialogueRewrites(
      skeleton,
      numbered,
      new Map([
        ["하나", [{ index: 1, text: "가자." }, { index: 2, text: "하나 판" }]],
        ["준", [{ index: 2, text: "준 판" }]]
      ])
    )

    expect(merged.text).toBe("하나가 말했다. “가자.” 준이 웃었다. “싫은데.” 하나가 돌아섰다.")
    expect(merged.contestedIndices).toEqual([2])
  })

  it("ignores an unknown index, an empty line, and a rewrite that smuggles in a second quote", () => {
    const merged = mergeDialogueRewrites(
      skeleton,
      numbered,
      new Map([["하나", [{ index: 9, text: "없는 번호" }, { index: 1, text: "  " }, { index: 2, text: "싫어. “가자.”" }]]])
    )

    expect(merged.text).toBe(skeleton)
    expect(merged.replacedCount).toBe(0)
  })
})

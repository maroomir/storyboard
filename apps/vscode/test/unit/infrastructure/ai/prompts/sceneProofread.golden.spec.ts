import { describe, expect, it } from "vitest"

import { SceneProofreadPrompt, type SceneProofreadInput } from "@storyboard/story-ai"

describe("SceneProofreadPrompt golden", () => {
  const withSuspects: SceneProofreadInput = {
    text: "성재는 벌써 반쯜 몸을 돌렸다.\n\n해가 뉘엿뉘엇 넘어갔다.",
    suspects: ["성재는 벌써 반쯜 몸을 돌렸다."]
  }
  const withoutSuspects: SceneProofreadInput = { text: "해가 뉘엿뉘엇 넘어갔다.", suspects: [] }

  it("lists the suspect syllables before the text", () => {
    expect(SceneProofreadPrompt.build(withSuspects)).toMatchSnapshot()
  })

  it("leaves out the suspect block when there are none", () => {
    const prompt = SceneProofreadPrompt.build(withoutSuspects)

    expect(prompt.user).not.toContain("[의심 글자]")
    expect(prompt).toMatchSnapshot()
  })
})

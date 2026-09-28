import { describe, expect, it } from "vitest"

import { SceneDialogueAttributionPrompt, type SceneDialogueAttributionInput } from "@storyboard/story-ai"

describe("SceneDialogueAttributionPrompt golden", () => {
  const full: SceneDialogueAttributionInput = {
    skeleton: "하나가 말했다. \"가자.\"\n준이 고개를 저었다. \"싫어.\"",
    lines: ["\"가자.\"", "\"싫어.\""],
    candidates: [
      { id: "hana", name: "하나" },
      { id: "jun", name: "준" }
    ]
  }
  const empty: SceneDialogueAttributionInput = { skeleton: "", lines: [], candidates: [] }

  it.each(["generic", "xs", "rich"] as const)("renders the %s variant", (variant) => {
    expect(SceneDialogueAttributionPrompt.build(full, variant)).toMatchSnapshot()
  })

  it.each(["generic", "xs"] as const)("renders empty lists for the %s variant", (variant) => {
    expect(SceneDialogueAttributionPrompt.build(empty, variant)).toMatchSnapshot()
  })
})

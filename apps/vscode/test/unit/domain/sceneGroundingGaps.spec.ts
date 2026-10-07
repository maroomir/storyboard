import { describe, expect, it } from "vitest"

import { computeSceneGroundingInputKey, type SceneFile } from "@storyboard/story-model"

function scene(body: string, grounding: Record<string, string>): SceneFile {
  return { stem: "01-a", body, frontmatter: { grounding } } as unknown as SceneFile
}

describe("computeSceneGroundingInputKey", () => {
  it("gives one key however the fields and the names are ordered", () => {
    const fromCard = computeSceneGroundingInputKey(scene("본문", { incident: "면접 탈락", place: "옥탑방" }), ["하나", "준"])
    const fromApproval = computeSceneGroundingInputKey(scene("본문", { place: "옥탑방 ", incident: "면접 탈락" }), ["준", "하나"])

    expect(fromApproval).toBe(fromCard)
  })

  it("changes with the scene text, the sheet and the cast", () => {
    const base = computeSceneGroundingInputKey(scene("본문", { incident: "면접 탈락" }), ["하나"])

    expect(computeSceneGroundingInputKey(scene("고친 본문", { incident: "면접 탈락" }), ["하나"])).not.toBe(base)
    expect(computeSceneGroundingInputKey(scene("본문", { incident: "합격" }), ["하나"])).not.toBe(base)
    expect(computeSceneGroundingInputKey(scene("본문", { incident: "면접 탈락" }), ["하나", "준"])).not.toBe(base)
  })
})

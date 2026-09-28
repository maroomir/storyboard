import { describe, expect, it } from "vitest"

import { StudioValidationPrompt } from "@storyboard/story-ai"

describe("StudioValidationPrompt golden", () => {
  it("renders the proposal against the material", () => {
    expect(
      StudioValidationPrompt.build({
        entityLabel: "엘리아",
        context: "[씬 03-harbor]\n엘리아는 약사로 일한다.",
        summary: "직업을 의사로 바꾼다",
        diff: "- description: 항구의 약사\n+ description: 항구의 의사"
      })
    ).toMatchSnapshot()
  })

  it("renders empty material and diff", () => {
    expect(StudioValidationPrompt.build({ entityLabel: "준", context: "", summary: "", diff: "" })).toMatchSnapshot()
  })
})
